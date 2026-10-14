export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1_000);
  const seconds = String(total % 60).padStart(2, '0');
  if (total >= 3600)
    return `${Math.floor(total / 3600)}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${seconds}`;
  return `${Math.floor(total / 60)}:${seconds}`;
}
export function formatPace(seconds: number | null): string {
  if (seconds === null) return `--'--"`;
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
export function formatDistance(meters: number): string {
  return (meters / 1_000).toFixed(2);
}
const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
export function formatRunDate(timestampMs: number): string {
  return dateFormatter.format(timestampMs);
}
