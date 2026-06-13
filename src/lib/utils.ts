import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Shared: build netscores URL mapping from match list
export async function buildNetscoresMapping(
  matches: { code: number; home: string; away: string; time: string }[]
): Promise<Record<number, string>> {
  const resp = await fetch(`/api/netscores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'mapping', matches }),
  })
  if (!resp.ok) return {}
  const data = await resp.json()
  const map: Record<number, string> = {}
  for (const m of data.mappings || []) {
    map[m.nesineCode] = m.netscoresUrl
  }
  return map
}
