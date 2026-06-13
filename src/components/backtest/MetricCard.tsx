export function MetricCard({ label, value, color, subtitle }: {
  label: string; value: string; color: string; subtitle?: string
}) {
  return (
    <div className="bg-gray-50 rounded-lg p-2 text-center">
      <div className={`text-sm font-black font-mono ${color}`}>{value}</div>
      <div className="text-[8px] text-gray-400 font-medium">{label}</div>
      {subtitle && <div className="text-[7px] text-gray-300">{subtitle}</div>}
    </div>
  )
}

export function PercentileBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-[9px] font-mono font-bold text-gray-700">{value}</div>
      <div className="text-[7px] text-gray-400">{label}</div>
    </div>
  )
}
