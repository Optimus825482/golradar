/**
 * Shared admin authentication helpers.
 * All admin pages should import from here instead of defining inline.
 */

export function authFetch(path: string, init?: RequestInit) {
  const token = sessionStorage.getItem("admin_token");
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
}

export function KPICard({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 bg-gradient-to-br from-gray-50 to-white">
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className="text-xl font-black" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
    </div>
  );
}
