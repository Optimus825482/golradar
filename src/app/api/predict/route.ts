import { NextResponse } from 'next/server';
import { predictEnsemble, type EnsembleInput } from '@/lib/ensemble';
import { retrainModel, loadModel, saveTrainingRecord } from '@/lib/goalPredictor';
import { extractFeatures, featuresToArray, type TrainingRecord } from '@/lib/featureEngineering';
import { extractMatchIntelligence } from '@/lib/fotmobIntelligence';
import { fetchMatchDetails } from '@/lib/fotmob';
import { rateLimit, RATE_LIMIT_DEFAULTS } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'predict';

  try {
    switch (action) {
      case 'predict': {
        const homeTeam = searchParams.get('home') || '';
        const awayTeam = searchParams.get('away') || '';
        const ruleScore = parseInt(searchParams.get('score') || '0');
        const minute = searchParams.get('minute') || '45';

        if (!homeTeam || !awayTeam) {
          return NextResponse.json({ error: 'home and away team names required' }, { status: 400 });
        }

        const stats: Record<string, { home: number | null; away: number | null }> = {};
        const statsParam = searchParams.get('stats');
        if (statsParam) {
          try {
            const parsed = JSON.parse(statsParam);
            for (const [key, val] of Object.entries(parsed)) {
              stats[key] = val as { home: number | null; away: number | null };
            }
          } catch {}
        }

        const homeGoals = parseInt(searchParams.get('hg') || '0');
        const awayGoals = parseInt(searchParams.get('ag') || '0');

        let intelligence = null;
        const fotmobId = searchParams.get('fotmobId');
        if (fotmobId) {
          try {
            const fotmobData = await fetchMatchDetails(parseInt(fotmobId));
            if (fotmobData) {
              intelligence = extractMatchIntelligence(fotmobData);
            }
          } catch (e: any) {
            console.warn('[Predict] FotMob intelligence failed:', e?.message || e);
          }
        }

        let result;
        try {
          const input: EnsembleInput = {
            stats,
            minute,
            isLive: true,
            homeGoals,
            awayGoals,
            homeTeam,
            awayTeam,
            ruleBasedScore: ruleScore || undefined,
            weather: intelligence?.weather ?? undefined,
          };
          result = predictEnsemble(input);
        } catch (e: any) {
          console.error('[Predict] Ensemble failed:', e?.message || e);
          // Fallback to simple calibrated score
          const simpleP = ruleScore > 0 ? ruleScore / 100 * 0.3 : 0.15;
          result = {
            probability: simpleP,
            score: ruleScore || 15,
            level: ruleScore >= 50 ? 'high' : ruleScore >= 30 ? 'medium' : 'low' as const,
            side: null as any,
            models: [{ name: 'Fallback', probability: simpleP, confidence: 0.3, weight: 1.0, details: 'Ensemble failed: ' + (e?.message || 'unknown') }],
            weights: { ruleBased: 1, poisson: 0, elo: 0, ml: 0 },
            dominantModel: 'Fallback',
            agreement: 0,
            overUnder25: 0,
            btts: 0,
            homeWinP: 0,
            drawP: 0,
            awayWinP: 0,
            topFeatures: [],
          };
        }

        if (intelligence && intelligence.totalGoalPAdjust !== 0) {
          result.probability = Math.max(0, Math.min(1, result.probability + intelligence.totalGoalPAdjust));
          result.score = Math.max(0, Math.min(85, Math.round(result.probability * 100)));
          result.models.push({
            name: 'FotMob Intel',
            probability: Math.round(Math.abs(intelligence.totalGoalPAdjust) * 1000) / 1000,
            confidence: 0.7,
            weight: 0.10,
            details: intelligence.allFactors.join(' | ') || 'No factors',
          });
        }

        return NextResponse.json(result);
      }

      case 'model': {
        const model = loadModel();
        if (!model) {
          return NextResponse.json({ status: 'no_model', message: 'Model not trained yet. Call /api/predict?action=train first.' });
        }
        return NextResponse.json({
          status: 'loaded',
          numTrees: model.trees.length,
          maxDepth: model.trainingMeta.maxDepth,
          numSamples: model.trainingMeta.numSamples,
          brierScore: model.trainingMeta.brierScore,
          trainedAt: new Date(model.trainingMeta.trainedAt).toISOString(),
          topFeatures: model.featureImportance
            .map((imp, idx) => ({ feature: idx, importance: Math.round(imp * 1000) / 1000 }))
            .filter(f => f.importance > 0.01)
            .sort((a, b) => b.importance - a.importance)
            .slice(0, 10),
        });
      }

      case 'train': {
        // Strict rate limit: max 5 train requests per minute per IP
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
        const rl = rateLimit(`train:${ip}`, RATE_LIMIT_DEFAULTS.strict);
        if (!rl.allowed) {
          return NextResponse.json(
            { error: `Rate limit exceeded. Try again in ${Math.ceil(rl.resetMs / 1000)}s.` },
            { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetMs / 1000)) } },
          );
        }
        const result = retrainModel();
        return NextResponse.json({
          success: result.success,
          brierScore: result.brierScore,
          numSamples: result.numSamples,
          message: result.success
            ? `Model trained with ${result.numSamples} samples, Brier=${result.brierScore.toFixed(4)}`
            : 'Training failed',
        });
      }

      case 'features': {
        const homeTeam = searchParams.get('home') || '';
        const awayTeam = searchParams.get('away') || '';
        const minute = searchParams.get('minute') || '45';

        const stats: Record<string, { home: number | null; away: number | null }> = {};
        const statsParam = searchParams.get('stats');
        if (statsParam) {
          try {
            const parsed = JSON.parse(statsParam);
            for (const [key, val] of Object.entries(parsed)) {
              stats[key] = val as { home: number | null; away: number | null };
            }
          } catch {}
        }

        const features = extractFeatures({
          stats,
          minute,
          isLive: true,
          homeGoals: parseInt(searchParams.get('hg') || '0'),
          awayGoals: parseInt(searchParams.get('ag') || '0'),
          homeTeam: homeTeam || undefined,
          awayTeam: awayTeam || undefined,
        });

        const featureArray = featuresToArray(features);
        return NextResponse.json({
          featureNames: Object.keys(features),
          featureValues: featureArray,
          count: featureArray.length,
        });
      }

      default:
        return NextResponse.json({ error: 'Unknown action. Use: predict, model, train, features' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('[Predict API] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'record') {
      const { features, label, matchCode, minute, side } = body;
      if (!features || label == null) {
        return NextResponse.json({ error: 'features and label required' }, { status: 400 });
      }

      const record: TrainingRecord = {
        features,
        label,
        matchCode: matchCode ?? -1,
        minute: minute ?? 0,
        timestamp: Date.now(),
        side: side ?? 'both',
      };

      saveTrainingRecord(record);
      return NextResponse.json({ success: true, message: 'Training record saved' });
    }

    if (action === 'predict-full') {
      const { stats, minute, homeGoals, awayGoals, homeTeam, awayTeam, ruleBasedScore, fotmobId } = body;

      let intelligence = null;
      if (fotmobId) {
        try {
          const fotmobData = await fetchMatchDetails(parseInt(fotmobId));
          if (fotmobData) {
            intelligence = extractMatchIntelligence(fotmobData);
          }
        } catch (e) {
          console.warn('[Predict] FotMob intelligence failed:', e);
        }
      }

      const input: EnsembleInput = {
        stats: stats || {},
        minute: minute || '45',
        isLive: true,
        homeGoals: homeGoals || 0,
        awayGoals: awayGoals || 0,
        homeTeam: homeTeam || undefined,
        awayTeam: awayTeam || undefined,
        ruleBasedScore: ruleBasedScore || undefined,
        weather: intelligence?.weather ?? undefined,
      };

      const result = predictEnsemble(input);

      if (intelligence && intelligence.totalGoalPAdjust !== 0) {
        result.probability = Math.max(0, Math.min(1, result.probability + intelligence.totalGoalPAdjust));
        result.score = Math.max(0, Math.min(85, Math.round(result.probability * 100)));
      }

      return NextResponse.json({
        ...result,
        intelligence: intelligence ? {
          weather: intelligence.weather,
          weatherFactors: intelligence.weatherImpact.factors,
          squadFactors: intelligence.squadImpact.factors,
          h2hFactors: intelligence.h2hImpact.factors,
          form: intelligence.form,
        } : null,
      });
    }

    return NextResponse.json({ error: 'Invalid action. Use: record, predict-full' }, { status: 400 });
  } catch (error: any) {
    console.error('[Predict API POST] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
