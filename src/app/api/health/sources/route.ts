import { NextResponse } from 'next/server';
import { breakers } from '@/lib/circuitBreaker';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sources = Object.values(breakers).map(b => ({
    name: b.name,
    state: b.getStatus().state,
    failures: b.getStatus().failures,
    open: b.isOpen,
  }));
  return NextResponse.json({ sources, healthy: sources.every(s => !s.open), timestamp: Date.now() });
}
