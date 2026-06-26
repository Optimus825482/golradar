import { NextResponse } from 'next/server';
import { calculateCalibrationStats, autoCalibrate } from '@/lib/calibration';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'stats';
  const days = searchParams.get('days') ? parseInt(searchParams.get('days')!) : undefined;

  try {
    switch (action) {
      case 'stats': {
        const stats = await calculateCalibrationStats(days);
        return NextResponse.json(stats);
      }

      case 'autocalibrate': {
        const result = await autoCalibrate();
        if (result) {
          return NextResponse.json({
            success: true,
            message: `Calibration updated: x0 ${result.x0}, k ${result.k}, L ${result.L}`,
            brierBefore: result.brierBefore,
            brierAfter: result.brierAfter,
            improvement: ((result.brierBefore - result.brierAfter) / result.brierBefore * 100).toFixed(1) + '%',
          });
        }
        return NextResponse.json({
          success: false,
          message: 'Not enough data for auto-calibration (need ≥50 records) or no improvement found',
        });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
