'use client'

export function NetScoresInfoTab({ data, homeTeam, awayTeam }: { data: any; homeTeam: string; awayTeam: string }) {
  const ns = data._netscores

  return (
    <div className="space-y-3">
      {data.infoBox?.stadium && (
        <div className="p-3 bg-gray-50 rounded-xl">
          <h5 className="text-[10px] font-bold text-gray-500 uppercase mb-1">Stadyum</h5>
          <div className="text-xs text-gray-700 font-medium">{data.infoBox.stadium.name}</div>
          <div className="text-[10px] text-gray-400">
            {data.infoBox.stadium.city}{data.infoBox.stadium.capacity ? ` · Kapasite: ${data.infoBox.stadium.capacity.toLocaleString()}` : ''}
          </div>
        </div>
      )}

      {ns?.leagueState && (ns.leagueState.home_position || ns.leagueState.away_position) && (
        <div className="p-3 bg-gradient-to-r from-orange-50 to-blue-50 rounded-xl">
          <h5 className="text-[10px] font-bold text-gray-500 uppercase mb-2">Lig Durumu</h5>
          <div className="flex items-center justify-between text-xs">
            <div className="text-center">
              <div className="text-lg font-black text-orange-600">{ns.leagueState.home_position || '-'}</div>
              <div className="text-[10px] text-gray-500 truncate max-w-[100px]">{homeTeam}</div>
            </div>
            <div className="text-[10px] text-gray-400">Sıralama</div>
            <div className="text-center">
              <div className="text-lg font-black text-blue-600">{ns.leagueState.away_position || '-'}</div>
              <div className="text-[10px] text-gray-500 truncate max-w-[100px]">{awayTeam}</div>
            </div>
          </div>
        </div>
      )}

      {ns?.xg && (parseFloat(ns.xg.home) > 0 || parseFloat(ns.xg.away) > 0) && (
        <div className="p-3 bg-gradient-to-r from-emerald-50 to-green-50 rounded-xl">
          <h5 className="text-[10px] font-bold text-gray-500 uppercase mb-2">Beklenen Gol (xG)</h5>
          <div className="flex items-center justify-between">
            <div className="text-center">
              <div className="text-2xl font-black text-orange-600">{parseFloat(ns.xg.home).toFixed(2)}</div>
              <div className="text-[10px] text-gray-500 truncate max-w-[100px]">{homeTeam}</div>
            </div>
            <div className="text-[10px] text-emerald-600 font-bold">xG</div>
            <div className="text-center">
              <div className="text-2xl font-black text-blue-600">{parseFloat(ns.xg.away).toFixed(2)}</div>
              <div className="text-[10px] text-gray-500 truncate max-w-[100px]">{awayTeam}</div>
            </div>
          </div>
        </div>
      )}

      {ns?.firstHalfScore && (
        <div className="p-3 bg-purple-50 rounded-xl">
          <h5 className="text-[10px] font-bold text-gray-500 uppercase mb-1">İlk Yarı Skoru</h5>
          <div className="text-lg font-black text-gray-800 text-center">{ns.firstHalfScore}</div>
        </div>
      )}

      {ns?.timer && ns.timer.current_minute && (
        <div className="p-3 bg-gray-50 rounded-xl text-xs">
          <div className="text-gray-600">
            <span className="font-bold">Dakika:</span> {ns.timer.current_minute}&apos;
            {ns.timer.added_minutes && ns.timer.added_minutes !== '0' && (
              <span className="text-orange-500"> +{ns.timer.added_minutes}</span>
            )}
            {ns.timer.is_ticking && <span className="ml-2 text-emerald-500 animate-pulse">● CANLI</span>}
          </div>
          {ns.ht_at && (
            <div className="text-gray-400 mt-1" suppressHydrationWarning>Devre Arası: {new Date(ns.ht_at).toLocaleTimeString('tr-TR')}</div>
          )}
        </div>
      )}

      {ns?.situation && ns.situation.action && (
        <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
          <div className="text-xs text-amber-700">
            <span className="font-bold">Son Durum:</span>{' '}
            {ns.situation.side === 'home' ? homeTeam : awayTeam} - {ns.situation.action}
            {ns.situation.player && ` (${ns.situation.player})`}
          </div>
        </div>
      )}

      {ns?.missingPlayers && ((ns.missingPlayers.home?.length ?? 0) > 0 || (ns.missingPlayers.away?.length ?? 0) > 0) && (
        <div className="p-3 bg-red-50 rounded-xl">
          <h5 className="text-[10px] font-bold text-gray-500 uppercase mb-2">Eksik Oyuncular</h5>
          {ns.missingPlayers.home?.length > 0 && (
            <div className="mb-1">
              <span className="text-[10px] font-semibold text-orange-600">{homeTeam}:</span>{' '}
              <span className="text-[10px] text-gray-600">{ns.missingPlayers.home.map((p: any) => p.name || p).join(', ')}</span>
            </div>
          )}
          {ns.missingPlayers.away?.length > 0 && (
            <div>
              <span className="text-[10px] font-semibold text-blue-600">{awayTeam}:</span>{' '}
              <span className="text-[10px] text-gray-600">{ns.missingPlayers.away.map((p: any) => p.name || p).join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
