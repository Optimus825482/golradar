'use client'

import { useRef, useMemo, memo, useEffect, useCallback } from 'react'
import { catmullRomPath } from '@/components/match/utils'
import { CleanChartCard } from './CleanChartCard'

const CHART_W = 1000, CHART_H = 380
const PAD = { l: 52, r: 24, t: 20, b: 36 }
const IW = CHART_W - PAD.l - PAD.r
const IH = CHART_H - PAD.t - PAD.b

const xS = (m: number, maxM: number) => PAD.l + (m / maxM) * IW
const yS = (v: number, maxV: number) => PAD.t + (1 - v / maxV) * IH

function computeXTicks(maxMin: number): number[] {
  const base = [0, 15, 30, 45]
  if (maxMin <= 45) return base
  const secondHalf = [60, 75, 90]
  const extra: number[] = []
  for (let m = 105; m <= maxMin + 10; m += 15) extra.push(m)
  return [...base, ...secondHalf, ...extra]
}

const homeColor = '#f97316', awayColor = '#3b82f6'

export const StatsLineChart = memo(function StatsLineChart({ data, homeKey, awayKey, homeName, awayName, homeTeam, awayTeam, title }: {
  data: any[]
  homeKey: string
  awayKey: string
  homeName: string
  awayName: string
  yDomain?: [number, number]
  yFormatter?: (v: number) => string
  homeTeam: string
  awayTeam: string
  title: string
}) {
  // Parse data into clean structure
  const points = useMemo(() => {
    if (!data?.length) return []
    return data.map(d => {
      const mn = typeof d.minute === 'number' ? d.minute : parseInt(String(d.minute).replace(/[^0-9]/g, ''), 10) || 0
      return {
        mn: isNaN(mn) ? 0 : mn,
        home: Number(d[homeKey]) || 0,
        away: Number(d[awayKey]) || 0,
      }
    })
  }, [data, homeKey, awayKey])

  const maxMinute = useMemo(() => Math.max(...points.map(p => p.mn), 90), [points])
  const maxVal = useMemo(() => {
    const mx = Math.max(...points.map(p => Math.max(p.home, p.away)), 1)
    return Math.ceil(mx / 5) * 5 || 5
  }, [points])

  const uid = useRef(`sl${Math.random().toString(36).slice(2, 9)}`).current
  const svgRef = useRef<HTMLDivElement>(null)
  const lpHRef = useRef<SVGPathElement>(null)
  const lpARef = useRef<SVGPathElement>(null)
  const aHRef = useRef<SVGPathElement>(null)
  const aARef = useRef<SVGPathElement>(null)
  const ggRef = useRef<SVGGElement>(null)
  const epRef = useRef<SVGGElement>(null)
  const hlRef = useRef<SVGLineElement>(null)
  const hdRef = useRef<SVGCircleElement>(null)
  const ttRef = useRef<HTMLDivElement>(null)
  const lkRef = useRef('')

  // DOM updates via refs
  useEffect(() => {
    if (points.length < 2) return
    const last = points[points.length - 1]
    const rk = `${points.length}_${last.mn}_${last.home}_${last.away}`
    if (rk === lkRef.current) return
    lkRef.current = rk

    const hPts: [number, number][] = points.map(d => [xS(d.mn, maxMinute), yS(d.home, maxVal)])
    const aPts: [number, number][] = points.map(d => [xS(d.mn, maxMinute), yS(d.away, maxVal)])
    const baseline = yS(0, maxVal)

    // Split at halftime
    const bi = points.findIndex(p => p.mn > 45)
    const h1 = bi > 0 ? hPts.slice(0, bi) : hPts
    const h2 = bi > 0 ? hPts.slice(bi) : []
    const a1 = bi > 0 ? aPts.slice(0, bi) : aPts
    const a2 = bi > 0 ? aPts.slice(bi) : []

    // Line paths
    const hPath = [h1.length >= 2 ? catmullRomPath(h1) : '', h2.length >= 2 ? catmullRomPath(h2) : ''].filter(Boolean).join(' ')
    const aPath = [a1.length >= 2 ? catmullRomPath(a1) : '', a2.length >= 2 ? catmullRomPath(a2) : ''].filter(Boolean).join(' ')

    if (lpHRef.current) lpHRef.current.setAttribute('d', hPath)
    if (lpARef.current) lpARef.current.setAttribute('d', aPath)

    // Area fill
    const areaPath = (pts1: [number, number][], pts2: [number, number][]) => {
      if (pts1.length < 2) return ''
      const a = catmullRomPath(pts1)
      if (!a) return ''
      const l = pts1[pts1.length - 1], f = pts1[0]
      return `${a} L ${l[0].toFixed(2)} ${baseline.toFixed(2)} L ${f[0].toFixed(2)} ${baseline.toFixed(2)} Z`
    }
    const hArea = [areaPath(h1, hPts), areaPath(h2, hPts)].filter(Boolean).join(' ').trim()
    const aArea = [areaPath(a1, aPts), areaPath(a2, aPts)].filter(Boolean).join(' ').trim()

    if (aHRef.current) aHRef.current.setAttribute('d', hArea)
    if (aARef.current) aARef.current.setAttribute('d', aArea)

    // Endpoints — atomic
    if (epRef.current) {
      const children: SVGCircleElement[] = []
      for (const pts of [hPts, aPts]) {
        for (const p of [pts[0], pts[pts.length - 1]]) {
          const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
          c.setAttribute('cx', p[0].toFixed(2)); c.setAttribute('cy', p[1].toFixed(2))
          c.setAttribute('r', '3.5'); c.setAttribute('fill', '#fff'); c.setAttribute('stroke', '#0f172a'); c.setAttribute('stroke-width', '1.5')
          children.push(c)
        }
      }
      epRef.current.replaceChildren(...children)
    }
  }, [points, maxMinute, maxVal])

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!svgRef.current || points.length === 0) return
    const rect = svgRef.current.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * CHART_W
    const mA = ((svgX - PAD.l) / IW) * maxMinute
    let n = points[0], bd = Math.abs(points[0].mn - mA)
    for (const d of points) { const d2 = Math.abs(d.mn - mA); if (d2 < bd) { n = d; bd = d2 } }
    const nx = xS(n.mn, maxMinute)
    if (hlRef.current) { hlRef.current.setAttribute('x1', nx.toFixed(2)); hlRef.current.setAttribute('x2', nx.toFixed(2)); hlRef.current.style.opacity = '1' }
    if (hdRef.current) { hdRef.current.setAttribute('cx', nx.toFixed(2)); hdRef.current.setAttribute('cy', yS(n.home, maxVal).toFixed(2)); hdRef.current.style.opacity = '1' }
    if (ttRef.current) {
      ttRef.current.style.left = `${(nx / CHART_W) * 100}%`; ttRef.current.style.top = '0px'; ttRef.current.style.display = 'block'
      ttRef.current.innerHTML = `<b style="color:#16a34a">${n.mn}'</b><br/><span style="color:${homeColor};font-weight:600">${homeName}: ${n.home}</span><br/><span style="color:${awayColor};font-weight:600">${awayName}: ${n.away}</span>`
    }
  }, [points, maxMinute, maxVal, homeName, awayName])

  const onLeave = useCallback(() => { if (hlRef.current) hlRef.current.style.opacity = '0'; if (hdRef.current) hdRef.current.style.opacity = '0'; if (ttRef.current) ttRef.current.style.display = 'none' }, [])

  if (points.length < 2) return (
    <CleanChartCard title={title} homeTeam={homeTeam} awayTeam={awayTeam}>
      <div className="h-70 flex items-center justify-center text-sm text-gray-400">Veri toplanıyor...</div>
    </CleanChartCard>
  )

  return (
    <CleanChartCard title={title} homeTeam={homeTeam} awayTeam={awayTeam}>
      <div ref={svgRef} style={{ position: 'relative', width: '100%', aspectRatio: '16 / 6', cursor: 'crosshair', contain: 'strict' }} onMouseMove={onMove} onMouseLeave={onLeave}>
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
          <defs>
            <linearGradient id={`hAG_${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={homeColor} stopOpacity={0.25} /><stop offset="100%" stopColor={homeColor} stopOpacity={0.02} /></linearGradient>
            <linearGradient id={`aAG_${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={awayColor} stopOpacity={0.25} /><stop offset="100%" stopColor={awayColor} stopOpacity={0.02} /></linearGradient>
          </defs>
          {/* Y axis gridlines */}
          {[0, Math.round(maxVal / 2), maxVal].map(v => {
            const y = yS(v, maxVal); return <g key={v}><line x1={PAD.l} y1={y} x2={CHART_W - PAD.r} y2={y} stroke={v === 0 ? '#cbd5e1' : '#f1f5f9'} strokeWidth={v === 0 ? 1 : 0.5} strokeDasharray={v === 0 ? '0' : '4 6'} /><text x={PAD.l - 6} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize={10}>{v}</text></g>
          })}
          {/* X axis ticks */}
          {computeXTicks(maxMinute).map(m => { const x = xS(m, maxMinute); return <g key={m}><line x1={x} y1={PAD.t} x2={x} y2={CHART_H - PAD.b} stroke={m === 45 ? '#16a34a' : '#e2e8f0'} strokeWidth={m === 45 ? 1 : 0.5} strokeDasharray={m === 45 ? '0' : '2 4'} opacity={m === 45 ? 0.6 : 0.5} /><text x={x} y={CHART_H - PAD.b + 16} textAnchor="middle" fill={m === 45 ? '#16a34a' : '#64748b'} fontSize={10} fontWeight={m === 45 ? 700 : 400}>{m}'{m === 45 ? ' DA' : ''}</text></g> })}
          {/* Area fills */}
          <path ref={aHRef} fill={`url(#hAG_${uid})`} />
          <path ref={aARef} fill={`url(#aAG_${uid})`} />
          {/* Lines */}
          <path ref={lpHRef} fill="none" stroke={homeColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          <path ref={lpARef} fill="none" stroke={awayColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          <g ref={epRef} />
          <line ref={hlRef} x1={0} y1={0} x2={0} y2={CHART_H} stroke="#0f172a" strokeWidth={1} opacity={0} strokeDasharray="4 4" />
          <circle ref={hdRef} cx={0} cy={0} r={5} fill="#fff" stroke="#0f172a" strokeWidth={2} opacity={0} />
        </svg>
        <div ref={ttRef} style={{ position: 'absolute', display: 'none', transform: 'translate(-50%, 0)', background: 'rgba(255,255,255,0.97)', border: '1px solid #e2e8f0', borderRadius: 10, padding: '6px 10px', fontSize: 11, whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(15,23,42,0.10)', zIndex: 10, pointerEvents: 'none', color: '#0f172a', textAlign: 'center' }} />
      </div>
    </CleanChartCard>
  )
})
