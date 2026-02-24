const DAY_MS = 24 * 60 * 60 * 1000;
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';
const EPOCH_MS = Date.parse(EPOCH_ISO);

function parseIso(iso: string): number | null {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeNowMs(): number {
  const runtimeNow = Date.now();
  return Number.isFinite(runtimeNow) ? runtimeNow : EPOCH_MS;
}

function toSafeIso(ms: number): string {
  return new Date(Number.isFinite(ms) ? ms : EPOCH_MS).toISOString();
}

export function nowIso(): string {
  const runtimeIso = toSafeIso(safeNowMs());
  return Number.isFinite(Date.parse(runtimeIso)) ? runtimeIso : EPOCH_ISO;
}

export function addDaysIso(iso: string, days: number): string {
  const base = parseIso(iso);
  const start = base === null ? safeNowMs() : base;
  const safeDays = Number.isFinite(days) ? days : 0;
  return toSafeIso(start + safeDays * DAY_MS);
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
