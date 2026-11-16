export function fmtDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '–';
  const m = Math.round(seconds / 60);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export const fmtRate = (r: number) => `${r.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}×`;
