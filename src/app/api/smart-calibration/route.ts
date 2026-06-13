import { NextResponse } from 'next/server';
import {
  calibrateF8,
  loadCalibrationMode,
  saveCalibrationMode,
  getAllLeagueProfiles,
  getSmartF8Adjustment,
  calculateOddsF8Compound,
  updateLeagueProfile,
  type CalibrationMode,
  type LeagueGoalProfile,
} from '@/lib/smartCalibration';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'status';
  const leagueId = searchParams.get('leagueId') ? parseInt(searchParams.get('leagueId')!) : null;

  try {
    switch (action) {
      // Get current calibration mode and league profiles
      case 'status': {
        const mode = loadCalibrationMode();
        const profiles = getAllLeagueProfiles();
        // Get F8 calibration preview for requested league
        const f8Result = calibrateF8(leagueId, mode);
        return NextResponse.json({
          mode,
          f8Calibration: {
            originalDampener: f8Result.originalDampener,
            calibratedDampener: f8Result.calibratedDampener,
            originalDangerBoost: f8Result.originalDangerBoost,
            calibratedDangerBoost: f8Result.calibratedDangerBoost,
            dangerZoneShift: f8Result.dangerZoneShift,
            dampenerZoneShift: f8Result.dampenerZoneShift,
            halftimeSurgeShift: f8Result.halftimeSurgeShift,
            source: f8Result.source,
            explanation: f8Result.explanation,
            leagueProfile: f8Result.leagueProfile ? {
              leagueName: f8Result.leagueProfile.leagueName,
              avgGoalMinute: f8Result.leagueProfile.avgGoalMinute,
              earlyGoalRate: f8Result.leagueProfile.earlyGoalRate,
              lateGoalRate: f8Result.leagueProfile.lateGoalRate,
            } : null,
          },
          profileCount: profiles.length,
          topLeagues: profiles.slice(0, 12).map(p => ({
            leagueId: p.leagueId,
            leagueName: p.leagueName,
            country: p.country,
            avgGoalMinute: Math.round(p.avgGoalMinute * 10) / 10,
            earlyGoalRate: Math.round(p.earlyGoalRate * 100),
            lateGoalRate: Math.round(p.lateGoalRate * 100),
            matchCount: p.matchCount,
          })),
        });
      }

      // Get all league profiles
      case 'profiles': {
        const profiles = getAllLeagueProfiles();
        return NextResponse.json(profiles);
      }

      // Preview F8 calibration for a specific league at a specific minute
      case 'preview': {
        const minute = parseInt(searchParams.get('minute') || '45');
        const mode = loadCalibrationMode();
        const f8Adj = getSmartF8Adjustment(minute, leagueId, mode);
        return NextResponse.json({
          minute,
          leagueId,
          minuteMultiplier: f8Adj.minuteMultiplier,
          homeScoreAdj: f8Adj.homeScoreAdj,
          awayScoreAdj: f8Adj.awayScoreAdj,
          factorDescription: f8Adj.factorDescription,
          calibration: {
            originalDampener: f8Adj.calibration.originalDampener,
            calibratedDampener: f8Adj.calibration.calibratedDampener,
            originalDangerBoost: f8Adj.calibration.originalDangerBoost,
            calibratedDangerBoost: f8Adj.calibration.calibratedDangerBoost,
            dangerZoneShift: f8Adj.calibration.dangerZoneShift,
            dampenerZoneShift: f8Adj.calibration.dampenerZoneShift,
            halftimeSurgeShift: f8Adj.calibration.halftimeSurgeShift,
            source: f8Adj.calibration.source,
            explanation: f8Adj.calibration.explanation,
          },
        });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      // Update calibration mode
      case 'setMode': {
        const mode: CalibrationMode = {
          mode: body.mode || 'auto',
          manualAvgGoalMinute: body.manualAvgGoalMinute ?? null,
          sensitivity: body.sensitivity ?? 0.7,
          oddsCompoundEnabled: body.oddsCompoundEnabled ?? true,
          minSampleSize: body.minSampleSize ?? 20,
        };
        saveCalibrationMode(mode);
        // Return updated F8 calibration preview
        const f8Result = calibrateF8(body.leagueId ?? null, mode);
        return NextResponse.json({
          success: true,
          mode,
          f8Calibration: {
            calibratedDampener: f8Result.calibratedDampener,
            calibratedDangerBoost: f8Result.calibratedDangerBoost,
            dangerZoneShift: f8Result.dangerZoneShift,
            source: f8Result.source,
            explanation: f8Result.explanation,
          },
        });
      }

      // Update league profile with match data
      case 'updateProfile': {
        const { leagueId, leagueName, country, goalMinutes } = body;
        if (!leagueId || !goalMinutes || !Array.isArray(goalMinutes)) {
          return NextResponse.json({ error: 'Missing required fields: leagueId, goalMinutes' }, { status: 400 });
        }
        const profile = updateLeagueProfile(leagueId, leagueName || '', country || '', goalMinutes);
        if (!profile) {
          return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
        }
        return NextResponse.json({ success: true, profile });
      }

      // Preview odds-F8 compound effect
      case 'previewCompound': {
        const { oddsSignificance, currentMinute, homeOddsBoost, awayOddsBoost, leagueId: lId } = body;
        const cal = calibrateF8(lId ?? null);
        const compound = calculateOddsF8Compound(
          cal,
          oddsSignificance || 'medium',
          currentMinute || 88,
          homeOddsBoost || 6,
          awayOddsBoost || 4,
        );
        return NextResponse.json({
          compound,
          f8Calibration: {
            calibratedDampener: cal.calibratedDampener,
            calibratedDangerBoost: cal.calibratedDangerBoost,
            dangerZoneShift: cal.dangerZoneShift,
            explanation: cal.explanation,
          },
        });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
