const MINUTE_IN_DAYS = 1 / 1440;
const HOUR_IN_DAYS = 1 / 24;
const WEEK_IN_DAYS = 7;
const YEAR_IN_DAYS = 365;
const MAX_INTERVAL_DAYS = 36500;

export function formatIntervalLabel(days: number): string {
  const normalizedDays = days === Number.POSITIVE_INFINITY ? MAX_INTERVAL_DAYS : days;

  if (!Number.isFinite(normalizedDays) || normalizedDays <= 0) {
    return '<1m';
  }

  if (normalizedDays < MINUTE_IN_DAYS) {
    return '<1m';
  }
  if (normalizedDays < HOUR_IN_DAYS) {
    return `${Math.max(1, Math.round(normalizedDays * 1440))}m`;
  }
  if (normalizedDays < 1) {
    return `${Math.max(1, Math.round(normalizedDays * 24))}h`;
  }
  if (normalizedDays < WEEK_IN_DAYS) {
    return `${Math.max(1, Math.floor(normalizedDays))}d`;
  }
  if (normalizedDays < 60) {
    return `${Math.max(1, Math.floor(normalizedDays / WEEK_IN_DAYS))}w`;
  }
  if (normalizedDays >= YEAR_IN_DAYS) {
    return `${Math.max(1, Math.floor(normalizedDays / YEAR_IN_DAYS))}y`;
  }

  if (normalizedDays >= YEAR_IN_DAYS - 1) {
    return `${Math.max(1, Math.floor(normalizedDays / YEAR_IN_DAYS))}y`;
  }
  return `${Math.max(1, Math.floor(normalizedDays / 30))}mo`;
}
