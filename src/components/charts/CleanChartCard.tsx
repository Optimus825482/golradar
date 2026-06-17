export function CleanChartCard({ title, homeTeam, awayTeam, children }: {
  title: string
  homeTeam: string
  awayTeam: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" style={{ contain: 'paint layout style' }}>
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h3 className="text-sm font-bold text-gray-800">{title}</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-orange-500" />
            <span className="text-[11px] text-gray-500 font-medium">{homeTeam}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-blue-500" />
            <span className="text-[11px] text-gray-500 font-medium">{awayTeam}</span>
          </div>
        </div>
      </div>
      <div className="px-2 pb-3">
        {children}
      </div>
    </div>
  )
}
