export function queueLoadStatusLabel(percent: number, repairCount: number, total: number): string {
  const safeRepairCount = Number.isFinite(repairCount) ? Math.max(0, repairCount) : 0;
  if (safeRepairCount > 0) {
    return 'Repair needed';
  }
  const safeTotal = Number.isFinite(total) ? total : 0;
  if (safeTotal <= 0) {
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
