'use client';

import { useEffect, useRef, useState } from 'react';

// ── Mermaid diagram source ───────────────────────────────────────
const SIGNAL_FLOW_DIAGRAM = `
flowchart TD
    Start([⏱️ Her 60 saniye<br/>Cron Worker]) --> Fetch[Nesine API<br/>GET /matches?sportType=1]
    Fetch --> Parse{Status<br/>Filtresi}

    Parse -->|S=4,5,6,7<br/>Live| Hydrate[Pressure History<br/>Singleton Map]
    Parse -->|S=3,28<br/>Devre Arası| Expire[expireSignalsForHalftime<br/>Bekleyen sinyalleri expire et]
    Parse -->|S=0,1<br/>Başlamadı/Bitti| Skip[Atla]

    Expire --> Next
    Hydrate --> CalcProb[calculateGoalProbability<br/>Feature Engineering]

    CalcProb --> HasStats{HasStats?}
    HasStats -->|Hayır| Skip
    HasStats -->|Evet| ScoreCheck{score >= 60<br/>threshold?}

    ScoreCheck -->|Hayır| Skip
    ScoreCheck -->|Evet| ZoneCheck{Dakika<br/>0-2, 43-45, 89+?}

    ZoneCheck -->|Yasaklı| Skip
    ZoneCheck -->|Geçerli| SideCheck{side<br/>home/away?}

    SideCheck -->|both / null| Skip
    SideCheck -->|home/away| Cooldown{Aynı match+side<br/>son 3dk içinde?}

    Cooldown -->|Evet| Update[Update last values<br/>Yeni sinyal oluşturma]
    Cooldown -->|Hayır| Record[(PostgreSQL<br/>Signal tablosuna INSERT)]

    Record --> Snapshot[(MatchSnapshot<br/>Pressure history)]
    Update --> Snapshot

    Snapshot --> Poll[15s'de bir poll<br/>Tüm canlı maçlar]

    Poll --> GoalDetect{Score değişti mi?}
    GoalDetect -->|Evet| Report[reportGoal<br/>goalSide, goalMinute]
    GoalDetect -->|Hayır| Next

    Report --> Finalize[goalHappened = true<br/>correctPrediction<br/>minutesAfterSignal]
    Finalize --> Stats[(SignalAccuracyStats<br/>Brier, Calibration)]

    Stats --> Train[MLScheduler<br/>15dk'da feature extract]
    Train --> Pipeline[pipelineRunner.runPipeline<br/>Train + Compare + Promote]
    Pipeline --> Promote{New Brier<br/>better?}
    Promote -->|Evet| Champion[(ModelArtifact<br/>isChampion=true)]
    Promote -->|Hayır| Shadow[(Shadow model<br/>A/B test)]

    Champion --> Next[Sonraki poll]

    style Start fill:#6366f1,stroke:#4f46e5,color:#fff
    style Fetch fill:#3b82f6,stroke:#2563eb,color:#fff
    style CalcProb fill:#8b5cf6,stroke:#7c3aed,color:#fff
    style Record fill:#10b981,stroke:#059669,color:#fff
    style Stats fill:#f59e0b,stroke:#d97706,color:#fff
    style Champion fill:#ef4444,stroke:#dc2626,color:#fff
    style Skip fill:#94a3b8,stroke:#64748b,color:#fff
`;

const CALIBRATION_FLOW_DIAGRAM = `
flowchart LR
    A[Ham Model<br/>Tahmini P] --> B[Isotonic<br/>Calibration]
    B --> C[Calibrated P<br/>0-1 arası]
    C --> D{Goal<br/>Gerçekleşti mi?}
    D -->|Evet 1| E[Brier =<br/>1-P squared]
    D -->|Hayır 0| F[Brier =<br/>P squared]
    E --> G[Brier Ortalaması]
    F --> G
    G --> H{Cron<br/>MLScheduler<br/>every 15m}
    H -->|Evet| I[Feature Extract<br/>47 features]
    I --> J[XGBoost / GBDT<br/>Train]
    J --> K{Brier<br/>düştü mü?}
    K -->|Evet| L[Promote<br/>isChampion=true]
    K -->|Hayır| M[Shadow olarak tut]
    L --> N[Production<br/>prediction]
    M --> N

    style A fill:#3b82f6,stroke:#2563eb,color:#fff
    style C fill:#8b5cf6,stroke:#7c3aed,color:#fff
    style G fill:#10b981,stroke:#059669,color:#fff
    style L fill:#f59e0b,stroke:#d97706,color:#fff
    style N fill:#ef4444,stroke:#dc2626,color:#fff
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
    title: '🎯 Gol Sinyali Akışı',
    description: 'Her 60 saniyede çalışan cron → Nesine fetch → goal probability → threshold + zone check → Signal tablosuna INSERT. Score değişiminde reportGoal → Brier score hesaplanır → MLScheduler ile model eğitimi → champion/shadow.',
    source: SIGNAL_FLOW_DIAGRAM,
  },
  {
    key: 'calibration',
    title: '🧮 Kalibrasyon Pipeline',
    description: 'Ham model tahmini → isotonic regression ile calibrated probability → gerçekleşen gol (0/1) ile Brier score → MLScheduler 15dk\'da feature extract → XGBoost train → yeni model iyiyse promote, kötüyse shadow.',
    source: CALIBRATION_FLOW_DIAGRAM,
  },
  {
    key: 'presence',
    title: '👥 Presence + Tier-Aware Polling',
    description: 'Browser mount → localStorage\'da sessionId → /api/presence ping (30s heartbeat) → server Map TTL prune → activeUserCount → resolveTier (LITE/MID/FULL) → tierConfig.pollIntervalMs → fetchMatches interval dinamik olarak değişir.',
    source: PRESENCE_FLOW_DIAGRAM,
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
        <h2 className="text-sm font-bold text-gray-800 mb-2">📐 Genel Mimari</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
          <PipelineStep
            num="1"
            title="Veri Toplama"
            color="blue"
            items={['Nesine canlı API', 'Cron worker (60s)', 'Pressure snapshots', 'Goal reporting']}
          />
          <PipelineStep
            num="2"
            title="Sinyal Üretimi"
            color="purple"
            items={['Feature engineering (47)', 'Goal probability', 'Threshold + zone check', 'Signal INSERT']}
          />
          <PipelineStep
            num="3"
            title="Öğrenme & Yayılım"
            color="emerald"
            items={['Brier calibration', 'MLScheduler (15m)', 'Champion / Shadow', 'Presence tier polling']}
          />
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
        </div>
      </div>
    </div>
  );
}

function PipelineStep({ num, title, color, items }: { num: string; title: string; color: 'blue' | 'purple' | 'emerald'; items: string[] }) {
  const colors: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50/50',
    purple: 'border-purple-200 bg-purple-50/50',
    emerald: 'border-emerald-200 bg-emerald-50/50',
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
