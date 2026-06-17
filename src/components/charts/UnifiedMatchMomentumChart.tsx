'use client'

import { useRef, useMemo, memo, useEffect, useCallback } from 'react'
import type { FotMobEvent, FotMobShot, FotMobMomentum } from '@/lib/fotmob'
import type { MomentumBarDataPoint, xGFlowPoint, ThreatIndex } from '@/lib/advancedAnalytics'
import { differentiateColors, catmullRomPath } from '@/components/match/utils'

interface UnifiedMatchMomentumChartProps {
  momentumBars: MomentumBarDataPoint[]
  xgFlowData: xGFlowPoint[]
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  homeColor: string
  awayColor: string
  threatIndex?: ThreatIndex | null
  fotmobMomentum?: FotMobMomentum | null
  fotmobShots?: FotMobShot[] | null
  fotmobHomeTeamId?: number
  fotmobAwayTeamId?: number
  goalEvents?: FotMobEvent[]
  isFotmobLoading?: boolean
}

function computeBarData(
  momentumBars: MomentumBarDataPoint[],
  xgFlowData: xGFlowPoint[],
  threatIndex: ThreatIndex | null | undefined,
  fotmobMomentum: FotMobMomentum | null | undefined,
  fotmobShots: FotMobShot[] | null | undefined,
  fotmobHomeTeamId: number | undefined,
  fotmobAwayTeamId: number | undefined,
  matchGoalEvents: FotMobEvent[] | undefined
) {
  const xtHomeBias = threatIndex ? (threatIndex.home / 100) * 25 : 0
  const xtAwayBias = threatIndex ? (threatIndex.away / 100) * 25 : 0

  if (fotmobMomentum?.main?.data && fotmobMomentum.main.data.length > 0) {
    const fmData = fotmobMomentum.main.data
    const homeXgAcc = new Map<number, number>()
    const awayXgAcc = new Map<number, number>()
    let cumHomeXg = 0, cumAwayXg = 0

    if (fotmobShots && fotmobShots.length > 0 && fotmobHomeTeamId && fotmobAwayTeamId) {
      const sortedShots = [...fotmobShots].sort((a, b) => a.min - b.min)
      for (const shot of sortedShots) {
        if (shot.teamId === fotmobHomeTeamId) cumHomeXg += shot.expectedGoals || 0
        else if (shot.teamId === fotmobAwayTeamId) cumAwayXg += shot.expectedGoals || 0
        homeXgAcc.set(Math.floor(shot.min), cumHomeXg)
        awayXgAcc.set(Math.floor(shot.min), cumAwayXg)
      }
    }

    const gH = new Set<number>(), gA = new Set<number>()
    if (matchGoalEvents) for (const ev of matchGoalEvents) {
      const m = typeof ev.time === 'number' ? ev.time : parseInt(String(ev.time).replace(/[^0-9]/g, ''), 10)
      if (!isNaN(m)) { if (ev.isHome) gH.add(m); else gA.add(m) }
    }

    const scale = 85 / Math.max(...fmData.map(x => Math.abs(x.value)), 0.5)
    return fmData.map(d => {
      const mn = Math.floor(d.minute)
      let hxg = 0, axg = 0
      for (const [m, v] of homeXgAcc) { if (m <= mn) hxg = v }
      for (const [m, v] of awayXgAcc) { if (m <= mn) axg = v }
      const sv = Math.max(-95, Math.min(95, d.value * scale))
      return { minute: `${mn}'`, minuteNum: mn, homeBar: sv >= 0 ? sv : 0, awayBar: sv < 0 ? sv : 0, homeXg: hxg, awayXg: axg, isGoalHome: gH.has(mn), isGoalAway: gA.has(mn) }
    })
  }

  if (momentumBars && momentumBars.length >= 2) {
    const maxFlow = Math.max(...momentumBars.map(d => Math.max(d.homeFlow, d.awayFlow)), 1)
    const xgI = xgFlowData.map(xf => ({ home: (xf.homeXgDelta ?? 0) * 50, away: (xf.awayXgDelta ?? 0) * 50 }))
    const mm = new Map<number, { hs: number; as: number; hx: number; ax: number; hxg: number; axg: number; gh: boolean; ga: boolean; c: number }>()

    for (let i = 0; i < momentumBars.length; i++) {
      const mb = momentumBars[i], mn = Math.floor(mb.minuteNum)
      const xm = xgFlowData.find(x => x.minute === mb.minute) || xgFlowData[i]
      const xi = xgI[i] ?? { home: 0, away: 0 }
      const e = mm.get(mn)
      if (e) { e.hs += mb.homeFlow; e.as += mb.awayFlow; e.hx += xi.home; e.ax += xi.away; e.hxg = xm?.homeXg ?? e.hxg; e.axg = xm?.awayXg ?? e.axg; e.gh = e.gh || mb.isGoalHome; e.ga = e.ga || mb.isGoalAway; e.c++ }
      else { mm.set(mn, { hs: mb.homeFlow, as: mb.awayFlow, hx: xi.home, ax: xi.away, hxg: xm?.homeXg ?? 0, axg: xm?.awayXg ?? 0, gh: mb.isGoalHome, ga: mb.isGoalAway, c: 1 }) }
    }

    const raw: { mn: number; rm: number; hxg: number; axg: number; gh: boolean; ga: boolean }[] = []
    for (const mn of [...mm.keys()].sort((a, b) => a - b)) {
      const m = mm.get(mn)!
      const hp = (m.hs / m.c / maxFlow) * 100 + m.hx * 0.3 + xtHomeBias
      const ap = (m.as / m.c / maxFlow) * 100 + m.ax * 0.3 + xtAwayBias
      raw.push({ mn, rm: hp - ap, hxg: m.hxg, axg: m.axg, gh: m.gh, ga: m.ga })
    }

    const ns = Math.max(85 / Math.max(...raw.map(r => Math.abs(r.rm)), 0.1), 5)
    return raw.map(r => {
      const m = Math.max(-95, Math.min(95, r.rm * ns))
      return { minute: `${r.mn}'`, minuteNum: r.mn, homeBar: m >= 0 ? Math.round(m * 10) / 10 : 0, awayBar: m < 0 ? Math.round(m * 10) / 10 : 0, homeXg: r.hxg, awayXg: r.axg, isGoalHome: r.gh, isGoalAway: r.ga }
    })
  }
  return []
}

const CHART_W = 1000, CHART_H = 420
const PAD = { l: 62, r: 30, t: 30, b: 40 }
const IW = CHART_W - PAD.l - PAD.r
const IH = CHART_H - PAD.t - PAD.b
const YT = [-100, -50, 0, 50, 100]
const BASE_TICKS = [0, 15, 30, 45]
const SECOND_HALF_TICKS = [60, 75, 90]
const xS = (m: number, maxM: number) => PAD.l + (m / maxM) * IW
const yS = (v: number) => PAD.t + (1 - (v + 100) / 200) * IH

function computeXTicks(maxMinute: number): number[] {
  if (maxMinute <= 45) return BASE_TICKS
  const extra: number[] = []
  for (let m = 105; m <= maxMinute + 10; m += 15) extra.push(m)
  return [...BASE_TICKS, ...SECOND_HALF_TICKS, ...extra]
}

export const UnifiedMatchMomentumChart = memo(function UnifiedMatchMomentumChart({
  momentumBars, xgFlowData, homeTeam, awayTeam,
  homeScore, awayScore, homeColor, awayColor,
  threatIndex, fotmobMomentum, fotmobShots,
  fotmobHomeTeamId, fotmobAwayTeamId,
  goalEvents: matchGoalEvents, isFotmobLoading,
}: UnifiedMatchMomentumChartProps) {
  const [vHome, vAway] = useMemo(() => differentiateColors(homeColor, awayColor), [homeColor, awayColor])
  const uid = useRef(`u${Math.random().toString(36).slice(2, 9)}`).current

  const barData = useMemo(() => computeBarData(momentumBars, xgFlowData, threatIndex, fotmobMomentum, fotmobShots, fotmobHomeTeamId, fotmobAwayTeamId, matchGoalEvents),
    [momentumBars, xgFlowData, threatIndex, fotmobMomentum, fotmobShots, fotmobHomeTeamId, fotmobAwayTeamId, matchGoalEvents])

  const goalEvents = useMemo(() => barData.filter(d => d.isGoalHome || d.isGoalAway), [barData])
  const maxMinute = useMemo(() => Math.max(...barData.map(d => d.minuteNum), 90), [barData])
  const md = useMemo(() => barData.map(d => ({ ...d, m: (d.homeBar ?? 0) + (d.awayBar ?? 0) })), [barData])

  // Refs for DOM manipulation
  const rootRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<HTMLDivElement>(null)
  const lpRef = useRef<SVGPathElement>(null)
  const apRef = useRef<SVGPathElement>(null)
  const anRef = useRef<SVGPathElement>(null)
  const ggRef = useRef<SVGGElement>(null)
  const epRef = useRef<SVGGElement>(null)
  const hlRef = useRef<SVGLineElement>(null)
  const hdRef = useRef<SVGCircleElement>(null)
  const ttRef = useRef<HTMLDivElement>(null)
  const lkRef = useRef('')
  const mdRef = useRef(md)
  mdRef.current = md

  // ResizeObserver for container width
  useEffect(() => {
    const el = svgRef.current; if (!el) return
    const ro = new ResizeObserver(es => { for (const e of es) { /* just trigger stable layout */ } })
    ro.observe(el); return () => ro.disconnect()
  }, [])

  // Stable path updates via DOM refs
  useEffect(() => {
    if (md.length < 2) return
    const last = md[md.length - 1]
    const rk = `${md.length}_${last.minuteNum}_${Math.round(last.m)}_${goalEvents.length}_${homeScore}_${awayScore}`
    if (rk === lkRef.current) return
    lkRef.current = rk

    const pts: [number, number][] = md.map(d => [xS(d.minuteNum, maxMinute), yS(d.m)])
    const zy = yS(0)
    const cp = (p: [number, number][]) => { if (p.length >= 2) return catmullRomPath(p); return '' }
    const lp = cp(pts)
    const lastP = pts[pts.length - 1]
    const ap = lp ? `${lp} L ${lastP[0].toFixed(2)} ${zy.toFixed(2)} L ${pts[0][0].toFixed(2)} ${zy.toFixed(2)} Z` : ''

    if (lpRef.current) lpRef.current.setAttribute('d', lp)
    if (apRef.current) apRef.current.setAttribute('d', ap)
    if (anRef.current) anRef.current.setAttribute('d', ap)

    // Goal markers — atomic replace to avoid flicker
    if (ggRef.current) {
      const newChildren: SVGElement[] = []
      for (const ev of goalEvents) {
        const cx = xS(ev.minuteNum, maxMinute), evM = (ev.homeBar ?? 0) + (ev.awayBar ?? 0), cy = yS(evM)
        const c = ev.isGoalHome ? vHome : vAway
        const ly = evM >= 0 ? cy - 18 : cy + 22
        const ns = (tag: string) => document.createElementNS('http://www.w3.org/2000/svg', tag)
        const l = ns('line'); l.setAttribute('x1', cx.toFixed(2)); l.setAttribute('y1', cy.toFixed(2)); l.setAttribute('x2', cx.toFixed(2)); l.setAttribute('y2', zy.toFixed(2)); l.setAttribute('stroke', c); l.setAttribute('stroke-width', '1'); l.setAttribute('stroke-dasharray', '3 3'); l.setAttribute('opacity', '0.3')
        const ci = ns('circle'); ci.setAttribute('cx', cx.toFixed(2)); ci.setAttribute('cy', cy.toFixed(2)); ci.setAttribute('r', '6'); ci.setAttribute('fill', c); ci.setAttribute('stroke', '#fff'); ci.setAttribute('stroke-width', '2'); ci.setAttribute('opacity', '0.9')
        const t = ns('text'); t.setAttribute('x', cx.toFixed(2)); t.setAttribute('y', ly.toFixed(2)); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '9'); t.setAttribute('font-weight', '700'); t.setAttribute('fill', c); t.textContent = `${ev.minuteNum}'`
        newChildren.push(l, ci, t)
      }
      ggRef.current.replaceChildren(...newChildren)
    }

    // Endpoints — atomic replace to avoid flicker
    if (epRef.current && pts.length > 0) {
      const epChildren: SVGCircleElement[] = []
      for (const p of [pts[0], pts[pts.length - 1]]) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        c.setAttribute('cx', p[0].toFixed(2)); c.setAttribute('cy', p[1].toFixed(2))
        c.setAttribute('r', '4'); c.setAttribute('fill', '#fff'); c.setAttribute('stroke', '#0f172a'); c.setAttribute('stroke-width', '2')
        epChildren.push(c)
      }
      epRef.current.replaceChildren(...epChildren)
    }
  }, [md, goalEvents, homeScore, awayScore, vHome, vAway, maxMinute])

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!svgRef.current || md.length === 0) return
    const rect = svgRef.current.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * CHART_W
    const mA = ((svgX - PAD.l) / IW) * maxMinute
    let n = md[0], bd = Math.abs(md[0].minuteNum - mA)
    for (const d of md) { const d2 = Math.abs(d.minuteNum - mA); if (d2 < bd) { n = d; bd = d2 } }
    const nx = xS(n.minuteNum, maxMinute), ny = yS(n.m)
    if (hlRef.current) { hlRef.current.setAttribute('x1', nx.toFixed(2)); hlRef.current.setAttribute('x2', nx.toFixed(2)); hlRef.current.style.opacity = '1' }
    if (hdRef.current) { hdRef.current.setAttribute('cx', nx.toFixed(2)); hdRef.current.setAttribute('cy', ny.toFixed(2)); hdRef.current.style.opacity = '1' }
    if (ttRef.current) {
      ttRef.current.style.left = `${(nx / CHART_W) * 100}%`; ttRef.current.style.top = `${(ny / CHART_H) * 100}%`; ttRef.current.style.display = 'block'
      const team = n.m > 5 ? homeTeam : n.m < -5 ? awayTeam : null, dc = n.m > 0 ? vHome : vAway
      ttRef.current.innerHTML = `<b style="color:#16a34a">${n.minuteNum}' </b><span style="color:${dc};font-weight:700">${!team ? 'Dengeli' : `${team} +${Math.abs(n.m).toFixed(0)}`}</span>${(n.homeXg > 0 || n.awayXg > 0) ? `<hr style="margin:2px 0;border:none;border-top:1px solid #eee"/> xG <b style="color:${vHome}">${n.homeXg.toFixed(2)}</b> &mdash; <b style="color:${vAway}">${n.awayXg.toFixed(2)}</b>` : ''}`
    }
  }, [md, maxMinute, homeTeam, awayTeam, vHome, vAway])

  const onLeave = useCallback(() => { if (hlRef.current) hlRef.current.style.opacity = '0'; if (hdRef.current) hdRef.current.style.opacity = '0'; if (ttRef.current) ttRef.current.style.display = 'none' }, [])

  if (barData.length < 2) return (
    <div className="rounded-xl overflow-hidden bg-white border border-gray-200 shadow-sm p-6" style={{ contain: 'strict' }}>
      <div className="flex items-center justify-center gap-2 text-gray-400">
        {isFotmobLoading ? <><div className="w-4 h-4 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" /><span className="text-sm">Veri yükleniyor...</span></> : <span className="text-sm">Momentum verisi toplanıyor...</span>}
      </div>
    </div>
  )

  return (
    <div ref={rootRef} className="rounded-xl overflow-hidden bg-white border border-gray-200 shadow-sm" style={{ contain: 'paint layout style', transform: 'translateZ(0)' }}>
      {threatIndex && Math.abs(threatIndex.home - threatIndex.away) >= 5 && (() => {
        const bc = threatIndex.home > threatIndex.away ? vHome : vAway
        return <div className="mx-3 mt-2 px-3 py-1 rounded-lg text-center" style={{ background: `linear-gradient(135deg, ${bc}12 0%, ${bc}06 100%)`, border: `1px solid ${bc}25` }}><span className="text-[11px] font-bold" style={{ color: bc }}>{threatIndex.interpretation}</span></div>
      })()}

      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: vHome }} />
          <span className="text-gray-900 text-xs font-bold truncate max-w-22.5">{homeTeam}</span>
          <span className="text-gray-900 text-lg font-black mx-0.5">{homeScore}</span>
          {barData.length > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: `${vHome}12`, color: vHome }}>{barData[barData.length - 1].homeXg.toFixed(2)} xG</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {barData.length > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: `${vAway}12`, color: vAway }}>{barData[barData.length - 1].awayXg.toFixed(2)} xG</span>}
          <span className="text-gray-900 text-lg font-black mx-0.5">{awayScore}</span>
          <span className="text-gray-900 text-xs font-bold truncate max-w-22.5">{awayTeam}</span>
          <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: vAway }} />
        </div>
      </div>

      <div className="px-2">
        <div ref={svgRef} style={{ position: 'relative', width: '100%', aspectRatio: '16 / 7', cursor: 'crosshair', contain: 'strict' }} onMouseMove={onMove} onMouseLeave={onLeave}>
          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
            <defs>
              <linearGradient id={`gP_${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={vHome} stopOpacity={0.55} /><stop offset="100%" stopColor={vHome} stopOpacity={0.03} /></linearGradient>
              <linearGradient id={`gN_${uid}`} x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor={vAway} stopOpacity={0.55} /><stop offset="100%" stopColor={vAway} stopOpacity={0.03} /></linearGradient>
              <linearGradient id={`gL_${uid}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor={vHome} /><stop offset="50%" stopColor="#0f172a" /><stop offset="100%" stopColor={vAway} /></linearGradient>
              <filter id={`gS_${uid}`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.5" result="blur" /><feOffset dx="0" dy="1" in="blur" result="offsetBlur" /><feComponentTransfer><feFuncA type="linear" slope="0.4" /></feComponentTransfer><feMerge><feMergeNode in="offsetBlur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            {YT.map(v => { const y = yS(v); return <g key={v}><line x1={PAD.l} y1={y} x2={CHART_W - PAD.r} y2={y} stroke={v === 0 ? '#94a3b8' : '#f1f5f9'} strokeWidth={v === 0 ? 1.5 : 0.75} strokeDasharray={v === 0 ? '0' : '4 6'} /><text x={PAD.l - 8} y={y + 4} textAnchor="end" fill={v === 0 ? '#334155' : (v === 100 ? vHome : v === -100 ? vAway : '#94a3b8')} fontSize={10} fontWeight={v === 0 || Math.abs(v) === 100 ? 700 : 400}>{v === 100 ? homeTeam.substring(0, 8) : v === -100 ? awayTeam.substring(0, 8) : (v > 0 ? '+' : '') + v}</text></g> })}
            {XT.map(m => { const x = xS(m, maxMinute); return <g key={m}><line x1={x} y1={PAD.t} x2={x} y2={CHART_H - PAD.b} stroke={m === 45 ? '#16a34a' : '#e2e8f0'} strokeWidth={m === 45 ? 1 : 0.5} strokeDasharray={m === 45 ? '0' : '2 4'} opacity={m === 45 ? 0.6 : 0.7} /><text x={x} y={CHART_H - PAD.b + 18} textAnchor="middle" fill={m === 45 ? '#16a34a' : '#64748b'} fontSize={11} fontWeight={m === 45 ? 700 : 400}>{m}'{m === 45 ? '  Devre Arası' : ''}</text></g> })}
            {computeXTicks(maxMinute).map(m => { const x = xS(m, maxMinute); return <g key={m}><line x1={x} y1={PAD.t} x2={x} y2={CHART_H - PAD.b} stroke={m === 45 ? '#16a34a' : '#e2e8f0'} strokeWidth={m === 45 ? 1 : 0.5} strokeDasharray={m === 45 ? '0' : '2 4'} opacity={m === 45 ? 0.6 : 0.7} /><text x={x} y={CHART_H - PAD.b + 18} textAnchor="middle" fill={m === 45 ? '#16a34a' : '#64748b'} fontSize={11} fontWeight={m === 45 ? 700 : 400}>{m}'{m === 45 ? '  Devre Arası' : ''}</text></g> })}
            <path ref={apRef} fill={`url(#gP_${uid})`} />
            <path ref={anRef} fill={`url(#gN_${uid})`} />
            <path ref={lpRef} fill="none" stroke={`url(#gL_${uid})`} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" filter={`url(#gS_${uid})`} />
            <g ref={ggRef} />
            <g ref={epRef} />
            <line ref={hlRef} x1={0} y1={0} x2={0} y2={0} stroke="#0f172a" strokeWidth={1} opacity={0} strokeDasharray="3 3" />
            <circle ref={hdRef} cx={0} cy={0} r={6} fill="#fff" stroke="#0f172a" strokeWidth={2} opacity={0} />
          </svg>
          <div ref={ttRef} style={{ position: 'absolute', display: 'none', transform: 'translate(-50%, -115%)', background: 'rgba(255,255,255,0.97)', border: '1px solid #e2e8f0', borderRadius: 10, padding: '6px 10px', fontSize: 11, whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(15,23,42,0.10)', zIndex: 10, pointerEvents: 'none', color: '#0f172a' }} />
        </div>
      </div>

      <div className="flex items-center justify-center gap-5 px-5 pb-1 pt-0.5 text-[10px]">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: vHome }} /><span className="text-gray-500 font-medium">{homeTeam}</span></span>
        <span className="w-px h-2.5 bg-gray-300" />
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: vAway }} /><span className="text-gray-500 font-medium">{awayTeam}</span></span>
        <span className="w-px h-2.5 bg-gray-300" />
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-gray-400" /><span className="text-gray-400">Gol</span></span>
      </div>

      {threatIndex && (() => {
        const ht = threatIndex.home, at = threatIndex.away, total = ht + at || 1, hp = Math.round((ht / total) * 100)
        return (
          <div className="mx-3 mt-1 mb-2 rounded-lg bg-gray-50/70 border border-gray-100 px-3 py-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-gray-600">xT Tehdit</span>
              <span className="flex items-center gap-2"><span className="text-[10px] font-black" style={{ color: vHome }}>{ht}</span><span className="text-[9px] text-gray-300">-</span><span className="text-[10px] font-black" style={{ color: vAway }}>{at}</span></span>
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-200/50">
              <div className="rounded-l-full" style={{ width: `${hp}%`, background: `linear-gradient(90deg, ${vHome}90, ${vHome})` }} />
              <div className="rounded-r-full" style={{ width: `${100 - hp}%`, background: `linear-gradient(270deg, ${vAway}90, ${vAway})` }} />
            </div>
            <div className="flex justify-between mt-1"><span className="text-[9px] font-semibold" style={{ color: vHome }}>{homeTeam} {hp}%</span><span className="text-[9px] font-semibold" style={{ color: vAway }}>{100 - hp}% {awayTeam}</span></div>
          </div>
        )
      })()}
    </div>
  )
})
