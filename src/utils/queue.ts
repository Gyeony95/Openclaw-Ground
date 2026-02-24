export function queueLoadStatusLabel(percent: number, repairCount: number, total: number): string {
  if (repairCount > 0) {
    return 'Repair needed';
  }
  if (total <= 0) {
    return 'Clear';
  }
  const boundedPercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  if (boundedPercent >= 80) {
    return 'Heavy';
  }
  if (boundedPercent >= 50) {
    return 'Moderate';
  }
  if (boundedPercent > 0) {
    return 'Light';
  }
  return 'Clear';
}
