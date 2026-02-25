const MINUTE_IN_DAYS = 1 / 1440;
const HOUR_IN_DAYS = 1 / 24;
const WEEK_IN_DAYS = 7;
const YEAR_IN_DAYS = 365;

export function formatIntervalLabel(days: number): string {
  if (!Number.isFinite(days) || days <= 0) {
    return '<1m';
  }

  if (days < MINUTE_IN_DAYS) {
    return '<1m';
  }
  if (days < HOUR_IN_DAYS) {
    return `${Math.max(1, Math.round(days * 1440))}m`;
  }
  if (days < 1) {
    return `${Math.max(1, Math.round(days * 24))}h`;
  }
  if (days < WEEK_IN_DAYS) {
    return `${Math.max(1, Math.floor(days))}d`;
  }
  if (days < 60) {
    return `${Math.max(1, Math.floor(days / WEEK_IN_DAYS))}w`;
  }
  if (days >= YEAR_IN_DAYS) {
    return `${Math.max(1, Math.floor(days / YEAR_IN_DAYS))}y`;
  }

  if (days >= YEAR_IN_DAYS - 1) {
    return `${Math.max(1, Math.floor(days / YEAR_IN_DAYS))}y`;
  }
  return `${Math.max(1, Math.floor(days / 30))}mo`;
}
