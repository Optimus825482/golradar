'use client';

import { useEffect, useRef, useState } from 'react';

// ── Mermaid diagram source ───────────────────────────────────────
const SIGNAL_FLOW_DIAGRAM = `
flowchart TD
    Start([⏱️ Poll cycle<br/>15-60sn]) --> Nesine[Nesine API<br/>GET /matches]
    Nesine --> Parse{Status}

    Parse -->|Live| Stats[Parse stats<br/>21 alan]
    Parse -->|Bitti/Devre| Skip[Skip]

    Stats --> FotMob[FotMob enrichment<br/>200ms timeout]
    FotMob --> ShotXG[Shot-level xG<br/>shotmap.sum]
    ShotXG --> Goaloo[Goaloo enrichment<br/>300ms timeout]
    
    Goaloo --> Odds[oddsMovement<br/>initial vs live]
    Odds --> Momentum[Momentum trend<br/>son 5dk ortalama]
    
	    Momentum --> CalcGoal[calculateGoalProbability<br/>12 factor heuristic]
	    CalcGoal --> Poisson[Poisson blend<br/>Dixon-Coles + inPlay]
	    Poisson --> Elo[Elo adjustment<br/>Dynamic K=50]
	    Elo --> Pi[Pi-Rating<br/>4 rating Ev/Dep]
	    Pi --> Glicko2[Glicko-2<br/>RD + σ volatility]
	    Glicko2 --> Gap[Lite GAP stub<br/>featuresJson DB]
	    Gap --> Ensemble[Ensemble 9-model<br/>Brier-tier weights]
	    Ensemble --> Corrector[ZISM Corrector<br/>Frank κ / Weibull]
	    Corrector --> Stacking[Stacking Meta-Model<br/>α=0-1 blend]
	    Stacking --> Calib[Calibration<br/>PAVA / Sigmoid]
	    
	    Calib --> SignalCheck{score >= 60<br/>side != null?}
	    SignalCheck -->|Hayır| Next
	    SignalCheck -->|Evet| Cooldown{Son 3dk<br/>cooldown?}
	    Cooldown -->|Evet| Update[Update last values]
	    Cooldown -->|Hayır| DB[(PostgreSQL<br/>Signal)]

    DB --> PollBack[Next poll]

    style Start fill:#6366f1,stroke:#4f46e5,color:#fff
    style Nesine fill:#3b82f6,stroke:#2563eb,color:#fff
    style FotMob fill:#06b6d4,stroke:#0891b2,color:#fff
    style Goaloo fill:#f59e0b,stroke:#d97706,color:#fff
    style CalcGoal fill:#8b5cf6,stroke:#7c3aed,color:#fff
    style Ensemble fill:#a855f7,stroke:#9333ea,color:#fff
    style Calib fill:#10b981,stroke:#059669,color:#fff
    style DB fill:#ef4444,stroke:#dc2626,color:#fff
`;

const NEW_FEATURES_DIAGRAM = `
flowchart TB
    subgraph Kalibrasyon["🎯 Kalibrasyon (3 katmanlı)"]
        A1[Ham Score 0-100] --> B1[Beta Calibration<br/>Beta CDF fit]
        B1 -->|varsa| C1[✅ Kalibre P]
        A1 --> B2[Isotonic Regression<br/>PAVA monotonic]
        B2 -->|varsa| C1
        A1 --> B3[Sigmoid + Temperature<br/>L / (1+exp(-z/T))]
        B3 --> C1
    end

    subgraph ModelKal["🔧 Per-Model Calibration"]
        D1[Her model kendi<br/>kalibrasyonuna sahip] --> E1[calibrateModelOutput]
        E1 --> F1[Beta / Isotonic / Sigmoid<br/>model bazında seçilir]
    end

    subgraph BMA["📊 Bayesian Model Averaging"]
        G1[Model 1 Brier] --> H1[exp(-B²/2σ²)]
        G2[Model 2 Brier] --> H1
        G3[Model N Brier] --> H1
        H1 --> I1[Posterior Weights]
        I1 --> J1[BMA Probability]
    end

    subgraph LSTM["📈 Trend LSTM"]
        K1[Son 10 dk<br/>Pressure trend] --> L1[Zaman ağırlıklı<br/>ortalama]
        L1 --> M1[Trend direction<br/>detection]
        M1 --> N1[Ani sıçrama<br/>analizi]
        N1 --> O1[Boost factor<br/>0-0.15]
    end

    subgraph LightGBM["🌲 LightGBM Trainer"]
        P1[Python sidecar] --> Q1[name: lightgbm]
        Q1 --> R1[LGBMClassifier]
        R1 --> S1[Brier / AUC / ECE]
    end

    style Kalibrasyon fill:#f0fdf4,stroke:#10b981
    style ModelKal fill:#f0f9ff,stroke:#3b82f6
    style BMA fill:#f5f3ff,stroke:#8b5cf6
    style LSTM fill:#fefce8,stroke:#f59e0b
    style LightGBM fill:#fef2f2,stroke:#ef4444
`;

const FACTOR_TABLE = [
  { f: 'F1', name: 'Pressure dominance', desc: 'calculatePressure weighted score >55%', max: 12, source: 'Nesine' },
  { f: 'F2', name: 'Dangerous attack rate', desc: 'DA per 15min >= 1.5', max: 14, source: 'Nesine' },
  { f: 'F3', name: 'Shot quality', desc: 'SOT rate/15min + accuracy bonus (xG removed)', max: 10, source: 'Nesine' },
  { f: 'F4', name: 'xG accumulation', desc: 'Kümülatif xG + velocity/15min (F10 entegre)', max: 14, source: 'Nesine + FotMob shotmap' },
  { f: 'F5', name: 'Stat spike detection', desc: 'DA/SOT/Corner delta vs 4 snapshot önce', max: 18, source: 'Nesine' },
  { f: 'F6', name: 'Momentum acceleration', desc: 'Pressure trend 5 snap + 2nd deriv', max: 10, source: 'Nesine' },
  { f: 'F7', name: 'Sustained pressure', desc: 'Son 5 snap press >55 count', max: 6, source: 'Nesine' },
  { f: 'F8', name: 'Minute context (calibrated)', desc: 'Lig bazlı F8 — calibrateF8Sync', max: '×1.15-1.45', source: 'Nesine + SmartCalibration' },
  { f: 'F9', name: 'Corner + SOT + set-piece', desc: 'Corner rate + SP ratio + accuracy', max: 14, source: 'Nesine' },
  { f: 'F10', name: '(REMOVED → F4)', desc: 'xG spike entegre edildi', max: 0, source: '—' },
  { f: 'F11', name: 'xG dominance', desc: 'xG ratio >0.70 (eski 0.65)', max: 8, source: 'Nesine' },
  { f: 'F12', name: 'Composite threat', desc: 'Territory + attack flow + trend', max: 16, source: 'Nesine' },
  { f: 'F13', name: 'xG flow momentum', desc: '3 recent vs 3 older xG avg (max 4)', max: 4, source: 'Nesine' },
  { f: 'F14', name: 'Goaloo momentum', desc: 'Per-minute 0-100, son5dk avg + trend', max: 8, source: 'Goaloo type=2' },
  { f: 'F15', name: 'Odds movement', desc: 'Live vs initial odds drop significance', max: 12, source: 'Goaloo type=1' },
  { f: 'F16', name: 'Dangerous sequence', desc: 'Multi-stat spike combo (capped 15)', max: 15, source: 'Nesine' },
  { f: 'F17', name: 'Organizasyon + fouls', desc: 'Pass_acc >75 / kontra atak / fouls ≥8', max: 14, source: 'Nesine ET=117,13' },
  { f: 'F18', name: 'Kaleci + blok', desc: 'Saves ≥3 + shots_blocked', max: 8, source: 'Nesine ET=116,120' },
  { f: 'F19', name: 'Ofsayt hattı', desc: 'Offsides ≥3 signal', max: 4, source: 'Nesine ET=9' },
  { f: 'F20', name: 'Kanat atak', desc: 'Crosses ≥3 + crossing_accuracy', max: 6, source: 'NetScores' },
  { f: 'F21', name: 'Penaltı + key passes', desc: 'Penalty + key_passes ≥3', max: 20, source: 'NetScores' },
];

const CALIBRATION_FLOW_DIAGRAM = `
flowchart LR
    A[Ham Model<br/>Tahmini P] --> B{Kaç model?}
    B -->|Tek model| B1[Per-Model Cal<br/>calibrateModelOutput]
    B1 --> C[Calibrated P<br/>0-1 arası]
    B -->|Ensemble| B2[Bayesian Model Avg<br/>Brier-based]
    B2 --> C
    C --> D{Goal<br/>Gerçekleşti mi?}
    D -->|Evet 1| E[Brier =<br/>(1-P)²]
    D -->|Hayır 0| F[Brier =<br/>P²]
    E --> G[Brier Ortalaması<br/>+ ECE + Log Loss]
    F --> G
    G --> H{autoCalibrate<br/>trigger}
    H -->|Her N sinyal| I[3 katmanlı kalibrasyon]
    I --> J1[Beta Calibration<br/>Kull et al. 2017]
    I --> J2[Isotonic (PAVA)<br/>Niculescu-Mizul 2005]
    I --> J3[Temperature Scaling<br/>Sigmoid / T]
    J1 --> K[Kalibrasyon DB'ye<br/>kaydedilir]
    J2 --> K
    J3 --> K
    K --> L[WebSocket<br/>push update]
    L --> M[Production<br/>prediction]

    style A fill:#3b82f6,stroke:#2563eb,color:#fff
    style C fill:#8b5cf6,stroke:#7c3aed,color:#fff
    style G fill:#10b981,stroke:#059669,color:#fff
    style J1 fill:#059669,stroke:#047857,color:#fff
    style J2 fill:#059669,stroke:#047857,color:#fff
    style J3 fill:#059669,stroke:#047857,color:#fff
    style M fill:#ef4444,stroke:#dc2626,color:#fff
`;

const PRESENCE_FLOW_DIAGRAM = `
flowchart LR
    A[Browser mount<br/>usePresence] --> B[localStorage<br/>sessionId generate]
    B --> C{Already<br/>mounted?}
    C -->|Hayır| D[POST /api/presence<br/>action=ping]
    C -->|Evet| D
    D --> E[Server: presencePing<br/>Map.set sessionId, now]
    E --> F[TTL Prune<br/>>120s sil]
    F --> G[activeUserCount]
    G --> H[resolveTier<br/>LITE/MID/FULL]
    H --> I{activeUsers<br/><=0?}
    I -->|Evet| J[LITE<br/>60s poll]
    I -->|<=10| K[MID<br/>30s poll]
    I -->|>10| L[FULL<br/>15s poll + heavy analytics]
    J --> M[page.tsx<br/>fetchMatches interval]
    K --> M
    L --> M

    style A fill:#6366f1,stroke:#4f46e5,color:#fff
    style D fill:#3b82f6,stroke:#2563eb,color:#fff
    style G fill:#8b5cf6,stroke:#7c3aed,color:#fff
    style H fill:#f59e0b,stroke:#d97706,color:#fff
    style L fill:#10b981,stroke:#059669,color:#fff
`;

	const DIAGRAMS = [
	  {
      key: 'signal',
      title: '🎯 Gol Sinyali Akışı (güncel)',
      description: 'Browser poll → Nesine API (21 stat) → FotMob (shot-level xG) → Goaloo (oddsMovement + momentum) → 12 faktör → Dixon-Coles Poisson → Elo → Pi-Rating (iç/dep) → Glicko-2 (RD+σ) → Lite GAP (stub) → Ensemble 9-model Brier-tier blend → ZISM/Weibull Corrector (κ=κ=-0.30) → Stacking Meta-Model (α=0-1) → PAVA/Sigmoid kalibrasyon → threshold+side check → Signal DB.',
      source: SIGNAL_FLOW_DIAGRAM,
	  },
	];

export default function AdminAlgorithmPage() {
  const [mermaidReady, setMermaidReady] = useState(false);
  const diagramRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const idCounter = useRef(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        themeVariables: {
          fontFamily: 'inherit',
          fontSize: '13px',
        },
        flowchart: {
          htmlLabels: true,
          curve: 'basis',
          padding: 12,
        },
      });
      if (mounted) setMermaidReady(true);
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!mermaidReady) return;
    (async () => {
      const mermaid = (await import('mermaid')).default;
      for (const d of DIAGRAMS) {
        const el = diagramRefs.current[d.key];
        if (!el) continue;
        try {
          const id = `mermaid-${d.key}-${idCounter.current++}`;
          const { svg } = await mermaid.render(id, d.source);
          el.innerHTML = svg;
        } catch (e) {
          el.textContent = `Render hatası: ${e}`;
        }
      }
    })();
  }, [mermaidReady]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-800">🧠 Algoritma Akış Diyagramları</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Gol Radarı sinyal motoru, kalibrasyon pipeline ve presence/tier sisteminin görsel akış şeması
        </p>
      </div>

	      {/* Pipeline Overview */}
	      <div className="bg-gradient-to-br from-indigo-50 via-white to-emerald-50 rounded-xl border border-gray-200 p-4 shadow-sm">
	        <h2 className="text-sm font-bold text-gray-800 mb-2">📐 Genel Mimari (21 faktör, 4 veri kaynağı)</h2>
	        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-[11px]">
	          <PipelineStep
	            num="1"
	            title="Nesine API"
	            color="blue"
	            items={['21 stat alanı (ET 0-122)', '15sn poll interval', 'xG, SOT, DA, fouls, saves', 'pass_accuracy, offsides']}
	          />
	          <PipelineStep
	            num="2"
	            title="FotMob + Goaloo"
	            color="purple"
	            items={['Shot-level xG (shotmap)', 'Goaloo oddsMovement', 'Goaloo momentum 0-100', 'NetScores (crosses/key_passes)']}
	          />
		        <PipelineStep
		            num="3"
		            title="Sinyal Üretimi"
		            color="emerald"
		            items={['12 faktör heuristic → raw score', 'Poisson + Elo + Pi-Rating + Glicko2', 'Ensemble 9-model Brier-tier blend', 'ZISM/Weibull Corrector (κ -0.30)', 'Stacking Meta-Model α-blend', 'PAVA/Sigmoid calibration', 'Threshold 60 + side ratio 0.62']}
		          />
	          <PipelineStep
	            num="4"
	            title="Öğrenme & Kalibrasyon"
	            color="orange"
	            items={['Train/val split grid search', 'Zaman ağırlıklı Brier', 'Lig bazlı F8 + xG katsayı', 'ML champion promotion']}
	          />
	        </div>
		      </div>

		      {/* Factor Table */}
		      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
		        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
		          <div className="w-1.5 h-5 rounded-full bg-gradient-to-b from-purple-400 to-indigo-500" />
		          <h3 className="text-sm font-bold text-gray-800">🧮 21 Faktör Detayı</h3>
		          <span className="text-[10px] text-gray-400 ml-auto">F10 kaldırıldı (F4'e entegre) · F14-21 yeni</span>
		        </div>
		        <div className="overflow-x-auto">
		          <table className="w-full text-[11px]">
		            <thead>
		              <tr className="bg-gray-50 border-b border-gray-100">
		                <th className="text-left px-3 py-2 font-semibold text-gray-500">#</th>
		                <th className="text-left px-3 py-2 font-semibold text-gray-500">Faktör</th>
		                <th className="text-left px-3 py-2 font-semibold text-gray-500">Açıklama</th>
		                <th className="text-right px-3 py-2 font-semibold text-gray-500">Max</th>
		                <th className="text-right px-3 py-2 font-semibold text-gray-500">Kaynak</th>
		              </tr>
		            </thead>
		            <tbody>
		              {FACTOR_TABLE.map(f => (
		                <tr key={f.f} className="border-b border-gray-50 hover:bg-gray-50/50">
		                  <td className="px-3 py-1.5 font-mono text-gray-400">{f.f}</td>
		                  <td className="px-3 py-1.5 font-semibold text-gray-700">{f.name}</td>
		                  <td className="px-3 py-1.5 text-gray-500">{f.desc}</td>
		                  <td className="px-3 py-1.5 text-right font-mono">{f.max}</td>
		                  <td className="px-3 py-1.5 text-right text-gray-400">{f.source}</td>
		                </tr>
		              ))}
		            </tbody>
		          </table>
		        </div>
		      </div>

		      {/* Mermaid diagrams */}
		      {DIAGRAMS.map(d => (
        <div key={d.key} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <div className="w-1.5 h-5 rounded-full bg-gradient-to-b from-indigo-400 to-purple-500" />
            <h3 className="text-sm font-bold text-gray-800">{d.title}</h3>
          </div>
          <div className="p-4">
            <p className="text-[11px] text-gray-600 mb-3 leading-relaxed">{d.description}</p>
            <div className="bg-gradient-to-br from-slate-50 to-white rounded-lg p-3 border border-gray-100 overflow-x-auto">
              <div
                ref={el => { diagramRefs.current[d.key] = el; }}
                className="mermaid-diagram flex justify-center min-h-[200px]"
              >
                {!mermaidReady && (
                  <div className="flex items-center justify-center py-12 text-xs text-gray-400">
                    <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full mr-2" />
                    Mermaid yükleniyor...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Key formulas */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-sm font-bold text-gray-800 mb-3">🧮 Temel Formüller</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
          <Formula
            title="Brier Score"
            formula="BS = (1/N) × Σ (p_i - o_i)²"
            description="p = tahmin olasılığı, o = gerçek sonuç (0/1). Düşük = iyi."
          />
          <Formula
            title="Doğruluk (Accuracy)"
            formula="Acc = (TP + TN) / N"
            description="Doğru tahmin edilen sinyal oranı (taraf + zamanlama)."
          />
          <Formula
            title="Kalibrasyon Hatası"
            formula="ECE = Σ |bucket_acc - bucket_conf| × n_bucket / N"
            description="Olasılık bucket'larının gözlemden sapması. Düşük = kalibre."
          />
	          <Formula
	            title="Success Rate"
	            formula="SR = (Excellent + Good + Late) / Resolved"
	            description="Sinyalden sonraki 15dk içinde gol olan oranı."
	          />
	          <Formula
	            title="Side Ratio"
	            formula="homeRatio = homeScore / (homeScore + awayScore) > 0.62"
	            description="Yeni oran-based side belirleme (eski threshold-based)."
	          />
	          <Formula
	            title="Kalibrasyon (PAVA)"
	            formula="p = isotonic(rawScore/100) ?? L/(1+exp(-k*(score-x0)))"
	            description="Önce PAVA monothonic mapping, yoksa sigmoid. Train/val split."
	          />
        </div>
      </div>

      {/* New Features */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-sm font-bold text-gray-800 mb-3">🚀 Yeni Eklenen Özellikler</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
          <Formula
            title="Temperature Scaling"
            formula="p = L / (1 + exp(-z / T))"
            description="Sigmoid'e T parametresi. T>1 daha düz (az güvenli), T<1 daha dik (çok güvenli). Varsayılan T=1.0."
          />
          <Formula
            title="Beta Calibration"
            formula="logit = c × ln(p/(1-p)) + d → sigmoid"
            description="[0,1] sınırlı olasılıklar için en iyisi. Platt/Isotonic'tan daha iyi (Kull 2017)."
          />
          <Formula
            title="Ensemble Calibration"
            formula="calibrateModelOutput(name, score)"
            description="Her model kendi kalibrasyonuna sahip. Beta/Isotonic/Sigmoid model bazında seçilir."
          />
          <Formula
            title="Bayesian Model Averaging"
            formula="w_i = exp(-Brier_i²/2σ²) / Σ exp(-Brier_j²/2σ²)"
            description="Brier-based posterior weights. Düşük Brier → yüksek weight. σ=0.25."
          />
          <Formula
            title="Trend LSTM"
            formula="boost = f(windows, minute, trend)"
            description="Son 10 dk pressure trend'inden goal probability boost. Ani sıçrama + yükselen trend tespiti."
          />
          <Formula
            title="LightGBM"
            formula="LGBMClassifier(n_estimators, max_depth)"
            description="Python sidecar'da XGBoost'a alternatif. name='lightgbm' ile eğitilir."
          />
          <Formula
            title="Online Weight Update"
            formula="recordPrediction(model, predicted, actual)"
            description="Son 500 sinyalin doğruluğuna göre ensemble ağırlıklarını dinamik ayarla."
          />
          <Formula
            title="Stacking Meta-Model"
            formula="logistic(Σ w_i × p_i + intercept)"
            description="Tüm model çıktılarını logistic regression meta-model ile birleştirir."
          />
          <Formula
            title="ClubElo API"
            formula="eloToWinProbability(homeElo, awayElo)"
            description="clubelo.com'dan bağımsız takım gücü ratingi. Ücretsiz, API key gerekmez."
          />
      <Formula
            title="Profit Simulation"
            formula="ROI = (totalReturned - totalStaked) / totalStaked"
            description="Sinyalleri hypothetical bahis olarak simüle eder: Sharpe, Drawdown, Win Rate."
          />
          <Formula
            title="Pi-Rating (Constantinou 2013)"
            formula="δ_exp = (Ha + Ad)/2 − (Hd + Aa)/2 + HOME_ADV"
            description="4 rating per takım: Ha, Hd, Aa, Ad. İç/deplasman ayrı, gol-farkı bazlı update. ξ=3.25e-3/gün, ω=0.05."
          />
          <Formula
            title="Glicko-2 (Glickman 2013)"
            formula="g(φ)=1/√(1+3φ²/π²) · E=1/(1+exp(-g(μᵢ-μⱼ)))"
            description="3-param r, RD, σ. İllinois Algorithm volatility update. HomeAdv +0.155µ. Ensemble'a RD-weighted drawP."
          />
          <Formula
            title="Frank's Copula Corrector"
            formula="cell'[h][a] = cell[h][a] · w(h,a; κ)"
            description="κ<0 pozitif korelasyon (equal-score boost). κ>0 negatif (stres). κ=-0.30 önerilen (BTTS %2.16 iyileşme)."
          />
          <Formula
            title="Weibull PMF + Copula"
            formula="weibullPMF(λ, k, shape=1.4)"
            description="Over-dispersion (variance>mean) için Weibull sayımı. Frank κ=-0.30 ile BTTS %19 iyileşme (McHale & Scarf 2011)."
          />
          <Formula
            title="Lite GAP Rating (stub)"
            formula="S_H = (Haᵢ + Adⱼ) / 2"
            description="Generalized Attacking Performance. 4 rating per takım. Şut/korner/xG non-rare event. featuresJson backfill bekliyor."
          />
          <Formula
            title="Stacking α-Blend"
            formula="finalP = (1-α)·BMA + α·Stacking"
            description="α=0.5 önerilen (%23.6 Brier iyileşme). Cold-start guard: 200+ örnek + agreement ≥0.4. STACKING_BLEND_ALPHA env."
          />
        </div>
      </div>
    </div>
  );
    }
	
	function PipelineStep({ num, title, color, items }: { num: string; title: string; color: 'blue' | 'purple' | 'emerald' | 'orange'; items: string[] }) {
	  const colors: Record<string, string> = {
	    blue: 'border-blue-200 bg-blue-50/50',
	    purple: 'border-purple-200 bg-purple-50/50',
	    emerald: 'border-emerald-200 bg-emerald-50/50',
	    orange: 'border-orange-200 bg-orange-50/50',
	  };
  return (
    <div className={`rounded-lg border p-3 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-base font-black text-gray-700">{num}.</span>
        <span className="font-bold text-gray-800">{title}</span>
      </div>
      <ul className="space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="text-gray-600 flex items-start gap-1">
            <span className="text-gray-400 mt-0.5">▸</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Formula({ title, formula, description }: { title: string; formula: string; description: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 bg-gradient-to-br from-gray-50 to-white">
      <div className="font-bold text-gray-800 mb-1">{title}</div>
      <div className="font-mono text-xs text-indigo-700 bg-white px-2 py-1.5 rounded border border-indigo-100 mb-1.5">{formula}</div>
      <div className="text-gray-500">{description}</div>
    </div>
  );
}
