import { NextResponse } from 'next/server'; import { db } from '@/lib/db';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') ?? 'json';
  const entity = searchParams.get('entity') ?? 'signals';
  const days = parseInt(searchParams.get('days') ?? '30');
  try {
    let rows: any[] = [];
    const cutoff = new Date(Date.now() - days * 86400000);
    if (entity === 'signals') rows = await db.signal.findMany({ where: { createdAt: { gte: cutoff } }, orderBy: { createdAt: 'desc' }, take: 10000 });
    else if (entity === 'predictions') rows = await db.predictionLog.findMany({ where: { createdAt: { gte: cutoff } }, orderBy: { createdAt: 'desc' }, take: 10000 });
    else if (entity === 'metrics') rows = await db.modelMetrics.findMany({ where: { date: { gte: cutoff } }, orderBy: { date: 'desc' }, take: 365 });
    else return NextResponse.json({ error: 'invalid entity' }, { status: 400 });
    if (format === 'csv') {
      const headers = rows.length ? Object.keys(rows[0]).join(',') : '';
      const body = rows.map((r: any) => Object.values(r).map(v => typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n');
      return new NextResponse(`${headers}\n${body}`, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename=golradar-${entity}-${days}d.csv` } });
    }
    return NextResponse.json({ entity, count: rows.length, rows });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
