export function QuickCard({
  label,
  value,
  sub,
  color,
  bg,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  bg: string;
}) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: bg }}>
      <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
        {label}
      </div>
      <div className="text-2xl font-black tracking-tight mt-1" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px] font-medium mt-1 opacity-80" style={{ color }}>
        {sub}
      </div>
    </div>
  );
}
