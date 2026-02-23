const DAY_MS = 24 * 60 * 60 * 1000;

function parseIso(iso: string): number | null {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDaysIso(iso: string, days: number): string {
  const base = parseIso(iso);
  const start = base === null ? Date.now() : base;
  return new Date(start + days * DAY_MS).toISOString();
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
