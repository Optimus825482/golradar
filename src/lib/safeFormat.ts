export const safeNum = (v: number | null | undefined, fb = 0): number =>
  typeof v === 'number' && !isNaN(v) ? v : fb;

export const fmtNum = (v: number | null | undefined, fb = '—'): string =>
  v != null && !isNaN(v) ? v.toLocaleString() : fb;

export const fmtDate = (v: string | number | null | undefined, locale = 'tr-TR'): string => {
  if (v == null) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString(locale);
};
