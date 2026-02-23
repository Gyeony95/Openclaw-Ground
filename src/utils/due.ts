const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const NOW_THRESHOLD_MS = 60 * 1000;

function parseIso(iso: string): number | null {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatDueLabel(dueAt: string, clockIso: string): string {
  const dueMs = parseIso(dueAt);
  const nowMs = parseIso(clockIso);
  if (dueMs === null || nowMs === null) {
    return 'Due date unavailable';
  }

  const deltaMs = dueMs - nowMs;
  if (Math.abs(deltaMs) <= NOW_THRESHOLD_MS) {
    return 'Due now';
  }
  if (deltaMs < 0 && Math.abs(deltaMs) < HOUR_MS) {
    return `Overdue ${Math.ceil(Math.abs(deltaMs) / MINUTE_MS)}m`;
  }
  if (deltaMs < 0 && Math.abs(deltaMs) < DAY_MS) {
    return `Overdue ${Math.ceil(Math.abs(deltaMs) / HOUR_MS)}h`;
  }
  if (deltaMs <= -DAY_MS) {
    return `Overdue ${Math.ceil(Math.abs(deltaMs) / DAY_MS)}d`;
  }
  if (deltaMs < HOUR_MS) {
    return `Due in ${Math.ceil(deltaMs / MINUTE_MS)}m`;
  }
  if (deltaMs < DAY_MS) {
    return `Due in ${Math.ceil(deltaMs / HOUR_MS)}h`;
  }
  return `Due in ${Math.ceil(deltaMs / DAY_MS)}d`;
}
