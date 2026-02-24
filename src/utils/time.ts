const DAY_MS = 24 * 60 * 60 * 1000;
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

function parseIso(iso: string): number | null {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

export function nowIso(): string {
  const runtimeNow = Date.now();
  if (!Number.isFinite(runtimeNow)) {
    return EPOCH_ISO;
  }
  const runtimeIso = new Date(runtimeNow).toISOString();
  return Number.isFinite(Date.parse(runtimeIso)) ? runtimeIso : EPOCH_ISO;
}

export function addDaysIso(iso: string, days: number): string {
  const base = parseIso(iso);
  const start = base === null ? Date.now() : base;
  const safeDays = Number.isFinite(days) ? days : 0;
  return new Date(start + safeDays * DAY_MS).toISOString();
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = parseIso(fromIso);
  const to = parseIso(toIso);

  if (from === null || to === null) {
    return 0;
  }

  return Math.max(0, (to - from) / DAY_MS);
}

export function isDue(dueAt: string, now: string): boolean {
  const due = parseIso(dueAt);
  const current = parseIso(now);

  if (due === null || current === null) {
    return false;
  }

  return due <= current;
}
