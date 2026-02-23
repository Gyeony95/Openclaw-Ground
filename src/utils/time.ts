const DAY_MS = 24 * 60 * 60 * 1000;

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDaysIso(iso: string, days: number): string {
  const ms = Date.parse(iso);
  return new Date(ms + days * DAY_MS).toISOString();
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  return Math.max(0, (to - from) / DAY_MS);
}

export function isDue(dueAt: string, now: string): boolean {
  return Date.parse(dueAt) <= Date.parse(now);
}
