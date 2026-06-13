'use client'

export function NetScoresEventsTab({ events, homeTeamName, awayTeamName }: { events: any[]; homeTeamName: string; awayTeamName: string }) {
  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto">
      {events.map((event, idx) => {
        const eventType = event.type || ''
        const isGoal = eventType.toLowerCase().includes('goal')
        const isYellow = eventType.toLowerCase().includes('yellow')
        const isRed = eventType.toLowerCase().includes('red')
        const isCard = isYellow || isRed
        const isSub = eventType.toLowerCase().includes('sub')
        const isCorner = eventType.toLowerCase().includes('corner')
        const isHalf = eventType.toLowerCase().includes('half') || eventType.toLowerCase().includes('score after')
        const isHome = event.isHome !== false
        const eventKey = `ev-${event.time || idx}-${eventType}-${idx}-${event.playerName || ''}`.replace(/\s+/g, '_')

        return (
          <div key={eventKey} className={`flex items-center gap-2 py-1.5 px-2 rounded-lg text-xs ${
            isGoal ? 'bg-green-50 border border-green-200' :
            isRed ? 'bg-red-50 border border-red-200' :
            isYellow ? 'bg-yellow-50 border border-yellow-200' :
            isSub ? 'bg-blue-50 border border-blue-200' :
            isHalf ? 'bg-purple-50 border border-purple-200' :
            'bg-gray-50'
          }`}>
            <span className="font-mono text-gray-400 w-8 text-center shrink-0">{event.time || ''}&apos;</span>
            <span className="shrink-0 text-sm">
              {isGoal ? '⚽' : isRed ? '🟥' : isYellow ? '🟨' : isSub ? '🔄' : isCorner ? '🚩' : isHalf ? '⏱️' : '📋'}
            </span>
            <span className={`flex-1 font-medium ${isHome ? 'text-left' : 'text-right'}`}>
              {event.playerName || event.text || ''}
            </span>
            <span className={`text-[10px] font-medium ${isHome ? 'text-orange-500' : 'text-blue-500'}`}>
              {isHome ? homeTeamName : awayTeamName}
            </span>
            {(event.homeScore != null && event.awayScore != null) && (
              <span className="text-[10px] font-mono text-gray-400">{event.homeScore}-{event.awayScore}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
