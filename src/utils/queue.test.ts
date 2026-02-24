import { queueLoadStatusLabel } from './queue';

describe('queueLoadStatusLabel', () => {
  it('prioritizes repair-needed state whenever repairs are pending', () => {
    expect(queueLoadStatusLabel(0, 1, 0)).toBe('Repair needed');
    expect(queueLoadStatusLabel(12, 2, 10)).toBe('Repair needed');
  });

  it('returns clear when queue is empty and no repairs exist', () => {
    expect(queueLoadStatusLabel(0, 0, 0)).toBe('Clear');
  });

  it('maps load bands when queue has cards and no repairs', () => {
    expect(queueLoadStatusLabel(0, 0, 10)).toBe('Clear');
    expect(queueLoadStatusLabel(10, 0, 10)).toBe('Light');
    expect(queueLoadStatusLabel(50, 0, 10)).toBe('Moderate');
    expect(queueLoadStatusLabel(80, 0, 10)).toBe('Heavy');
  });
});
