export function queueLoadStatusLabel(percent: number, repairCount: number, total: number): string {
  if (repairCount > 0) {
    return 'Repair needed';
  }
  if (total <= 0) {
    return 'Clear';
  }
  if (percent >= 80) {
    return 'Heavy';
  }
  if (percent >= 50) {
    return 'Moderate';
  }
  if (percent > 0) {
    return 'Light';
  }
  return 'Clear';
}
