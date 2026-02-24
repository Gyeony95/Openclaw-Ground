import { colors } from '../theme';
import { dueUrgency, queueTone } from './scheduleStatus';

const NOW = '2026-02-24T12:00:00.000Z';

describe('scheduleStatus', () => {
  describe('queueTone', () => {
    it('shows warning tone for repair-needed due cards even if dueAt is in the future', () => {
      const tone = queueTone({
        dueAt: '2026-02-24T14:00:00.000Z',
        clockIso: NOW,
        loading: false,
        hasDueCard: true,
        needsRepair: true,
      });

      expect(tone).toBe(colors.warn);
    });

    it('keeps success tone when queue has no due card', () => {
      const tone = queueTone({
        dueAt: undefined,
        clockIso: NOW,
        loading: false,
        hasDueCard: false,
        needsRepair: false,
      });

      expect(tone).toBe(colors.success);
    });

    it('uses primary tone for cards that are due now within the one-minute window', () => {
      const tone = queueTone({
        dueAt: '2026-02-24T12:00:30.000Z',
        clockIso: NOW,
        loading: false,
        hasDueCard: true,
        needsRepair: false,
      });

      expect(tone).toBe(colors.primary);
    });

    it('uses danger tone only when the card is materially overdue', () => {
      const tone = queueTone({
        dueAt: '2026-02-24T11:58:30.000Z',
        clockIso: NOW,
        loading: false,
        hasDueCard: true,
        needsRepair: false,
      });

      expect(tone).toBe(colors.danger);
    });
  });

  describe('dueUrgency', () => {
    it('prioritizes repair label for malformed schedules', () => {
      const urgency = dueUrgency({
        dueAt: '2026-02-24T14:00:00.000Z',
        clockIso: NOW,
        needsRepair: true,
      });

      expect(urgency).toEqual({ label: 'Needs repair', tone: colors.warn });
    });

    it('uses due-now label for schedules within the one-minute window', () => {
      const urgency = dueUrgency({
        dueAt: '2026-02-24T12:00:30.000Z',
        clockIso: NOW,
        needsRepair: false,
      });

      expect(urgency).toEqual({ label: 'Due now', tone: colors.primary });
    });
  });
});
