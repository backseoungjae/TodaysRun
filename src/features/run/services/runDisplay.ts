export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1_000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
export function formatPace(seconds: number | null): string {
  if (seconds === null) return '—';
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
