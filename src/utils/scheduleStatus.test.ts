import { colors } from '../theme';
import { dueUrgency, queueTone } from './scheduleStatus';

const NOW = '2026-02-24T12:00:00.000Z';

describe('scheduleStatus', () => {
  describe('queueTone', () => {
    it('does not hide overdue due-card urgency when unrelated repairs are pending', () => {
      const tone = queueTone({
        dueAt: '2026-02-24T11:58:30.000Z',
        clockIso: NOW,
        loading: false,
        hasDueCard: true,
        needsRepair: false,
        hasPendingRepairs: true,
      });

      expect(tone).toBe(colors.danger);
    });

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

    it('shows warning tone when queue is clear but schedule repairs are pending', () => {
      const tone = queueTone({
        dueAt: undefined,
        clockIso: NOW,
        loading: false,
        hasDueCard: false,
        needsRepair: false,
        hasPendingRepairs: true,
      });

      expect(tone).toBe(colors.warn);
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

    it('uses success tone when the next due card is comfortably in the future', () => {
      const tone = queueTone({
        dueAt: '2026-02-24T16:00:00.000Z',
        clockIso: NOW,
        loading: false,
        hasDueCard: true,
        needsRepair: false,
      });

      expect(tone).toBe(colors.success);
    });

    it('treats loose non-ISO dueAt values as malformed schedule inputs', () => {
      const tone = queueTone({
        dueAt: '2026-02-24 11:58:30Z',
        clockIso: NOW,
        loading: false,
        hasDueCard: true,
        needsRepair: false,
      });

      expect(tone).toBe(colors.warn);
    });

    it('accepts surrounding whitespace on ISO timestamps', () => {
      const tone = queueTone({
        dueAt: ' 2026-02-24T11:58:30.000Z ',
        clockIso: ` ${NOW} `,
        loading: false,
        hasDueCard: true,
        needsRepair: false,
      });

      expect(tone).toBe(colors.danger);
    });

    it('accepts boxed and numeric timestamps from runtime bridges', () => {
      const boxedTone = queueTone({
        dueAt: new String('2026-02-24T11:58:30.000Z') as unknown as string,
        clockIso: new String(NOW) as unknown as string,
        loading: false,
        hasDueCard: true,
        needsRepair: false,
      });
      const numericTone = queueTone({
        dueAt: Date.parse('2026-02-24T11:58:30.000Z') as unknown as string,
        clockIso: Date.parse(NOW) as unknown as string,
        loading: false,
        hasDueCard: true,
        needsRepair: false,
      });

      expect(boxedTone).toBe(colors.danger);
      expect(numericTone).toBe(colors.danger);
    });

    it('accepts boxed numeric and valueOf-backed timestamps from runtime bridges', () => {
      const boxedNumericTone = queueTone({
        dueAt: new Number(Date.parse('2026-02-24T11:58:30.000Z')) as unknown as string,
        clockIso: new Number(Date.parse(NOW)) as unknown as string,
        loading: false,
        hasDueCard: true,
        needsRepair: false,
      });
      const valueOfTone = queueTone({
        dueAt: {
          valueOf() {
            return Date.parse('2026-02-24T11:58:30.000Z');
          },
        } as unknown as string,
        clockIso: {
          valueOf() {
            return NOW;
          },
        } as unknown as string,
        loading: false,
        hasDueCard: true,
        needsRepair: false,
      });

      expect(boxedNumericTone).toBe(colors.danger);
      expect(valueOfTone).toBe(colors.danger);
    });

    it('accepts lowercase-z UTC timestamps', () => {
      const tone = queueTone({
        dueAt: '2026-02-24T11:58:30.000z',
        clockIso: '2026-02-24T12:00:00.000z',
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

    it('prioritizes repair label even when dueAt is missing', () => {
      const urgency = dueUrgency({
        dueAt: undefined,
        clockIso: NOW,
        needsRepair: true,
      });

      expect(urgency).toEqual({ label: 'Needs repair', tone: colors.warn });
    });

    it('treats missing dueAt as needing repair when no explicit repair flag is present', () => {
      const urgency = dueUrgency({
        dueAt: undefined,
        clockIso: NOW,
        needsRepair: false,
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

    it('shows minute-level labels for near-future due cards', () => {
      const urgency = dueUrgency({
        dueAt: '2026-02-24T12:30:00.000Z',
        clockIso: NOW,
        needsRepair: false,
      });

      expect(urgency).toEqual({ label: 'Due in 30m', tone: colors.warn });
    });

    it('shows elapsed overdue labels for overdue cards', () => {
      const urgency = dueUrgency({
        dueAt: '2026-02-24T10:00:00.000Z',
        clockIso: NOW,
        needsRepair: false,
      });

      expect(urgency).toEqual({ label: 'Overdue 2h', tone: colors.danger });
    });

    it('shows future due labels for comfortably scheduled cards', () => {
      const urgency = dueUrgency({
        dueAt: '2026-02-24T16:00:00.000Z',
        clockIso: NOW,
        needsRepair: false,
      });

      expect(urgency).toEqual({ label: 'Due in 4h', tone: colors.success });
    });

    it('flags loose non-ISO dueAt values as needing repair', () => {
      const urgency = dueUrgency({
        dueAt: '2026-02-24 12:00:30Z',
        clockIso: NOW,
        needsRepair: false,
      });

      expect(urgency).toEqual({ label: 'Needs repair', tone: colors.warn });
    });

    it('accepts surrounding whitespace on due and clock timestamps', () => {
      const urgency = dueUrgency({
        dueAt: ' 2026-02-24T12:00:30.000Z ',
        clockIso: ` ${NOW} `,
        needsRepair: false,
      });

      expect(urgency).toEqual({ label: 'Due now', tone: colors.primary });
    });

    it('accepts boxed and numeric due timestamps from runtime bridges', () => {
      const boxed = dueUrgency({
        dueAt: new String('2026-02-24T12:00:30.000Z') as unknown as string,
        clockIso: new String(NOW) as unknown as string,
        needsRepair: false,
      });
      const numeric = dueUrgency({
        dueAt: Date.parse('2026-02-24T12:00:30.000Z') as unknown as string,
        clockIso: Date.parse(NOW) as unknown as string,
        needsRepair: false,
      });

      expect(boxed).toEqual({ label: 'Due now', tone: colors.primary });
      expect(numeric).toEqual({ label: 'Due now', tone: colors.primary });
    });

    it('accepts boxed numeric and valueOf-backed due timestamps from runtime bridges', () => {
      const boxedNumeric = dueUrgency({
        dueAt: new Number(Date.parse('2026-02-24T12:00:30.000Z')) as unknown as string,
        clockIso: new Number(Date.parse(NOW)) as unknown as string,
        needsRepair: false,
      });
      const valueOfBacked = dueUrgency({
        dueAt: {
          valueOf() {
            return Date.parse('2026-02-24T12:00:30.000Z');
          },
        } as unknown as string,
        clockIso: {
          valueOf() {
            return NOW;
          },
        } as unknown as string,
        needsRepair: false,
      });

      expect(boxedNumeric).toEqual({ label: 'Due now', tone: colors.primary });
      expect(valueOfBacked).toEqual({ label: 'Due now', tone: colors.primary });
    });

    it('accepts lowercase-z UTC timestamps', () => {
      const urgency = dueUrgency({
        dueAt: '2026-02-24T12:00:30.000z',
        clockIso: '2026-02-24T12:00:00.000z',
        needsRepair: false,
      });

      expect(urgency).toEqual({ label: 'Due now', tone: colors.primary });
    });
  });
});
