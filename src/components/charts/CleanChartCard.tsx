export function CleanChartCard({ title, homeTeam, awayTeam, homeColor, awayColor, children }: {
  title: string
  homeTeam: string
  awayTeam: string
  homeColor?: string
  awayColor?: string
  children: React.ReactNode
}) {
  const hc = homeColor || '#f97316'
  const ac = awayColor || '#3b82f6'
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h3 className="text-sm font-bold text-gray-800">{title}</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: hc }} />
            <span className="text-[11px] text-gray-500 font-medium">{homeTeam}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: ac }} />
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
