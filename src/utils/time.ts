const DAY_MS = 24 * 60 * 60 * 1000;
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';
const EPOCH_MS = Date.parse(EPOCH_ISO);
const MIN_DATE_MS = -8640000000000000;
const MAX_DATE_MS = 8640000000000000;
const ISO_DATE_TIME_RE = /^[+-]?\d{4,6}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:[Zz]|[+-]\d{2}:\d{2})$/;

export function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_TIME_RE.test(value) && Number.isFinite(Date.parse(value));
}

function parseIso(iso: string): number | null {
  if (!isIsoDateTime(iso)) {
    return null;
  }
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeNowMs(): number {
  const runtimeNow = Date.now();
  return Number.isFinite(runtimeNow) ? runtimeNow : EPOCH_MS;
}

function toSafeIso(ms: number): string {
  const safeMs = Number.isFinite(ms)
    ? Math.min(MAX_DATE_MS, Math.max(MIN_DATE_MS, ms))
    : EPOCH_MS;
  return new Date(safeMs).toISOString();
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
