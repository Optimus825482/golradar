export function QuickCard({ label, value, sub, color, bg }: {
  label: string; value: string; sub: string; color: string; bg: string
}) {
  return (
    <div className={`${bg} rounded-xl border border-gray-200 p-3 shadow-sm`}>
      <div className={`text-2xl font-black font-mono ${color}`}>{value}</div>
      <div className="text-[9px] font-bold text-gray-500 mt-0.5">{label}</div>
      <div className="text-[8px] text-gray-400 mt-0.5">{sub}</div>
    </div>
  )
}
