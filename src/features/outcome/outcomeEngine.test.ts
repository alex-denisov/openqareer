import { describe, expect, it } from 'vitest';
import {
  recommendNextAction,
  recordOutcome,
  undoOutcome,
  validateOutcomeInput,
} from './outcomeEngine';

const OPPORTUNITY_ID = 'opportunity-1';

describe('outcome and next-action loop', () => {
  it('does not call silence a rejection and waits until the chosen follow-up', () => {
    const sent = recordOutcome(
      OPPORTUNITY_ID,
      {
        type: 'applied',
        occurredAt: '2026-07-31T09:00:00.000Z',
        note: 'Отправлено через официальный интерфейс.',
        followUpAt: '2026-08-05T09:00:00.000Z',
      },
      '2026-07-31T09:05:00.000Z',
    );

    expect(
      recommendNextAction(
        OPPORTUNITY_ID,
        [sent],
        '2026-08-02T09:00:00.000Z',
      ),
    ).toMatchObject({
      code: 'wait-until-follow-up',
      dueAt: '2026-08-05T09:00:00.000Z',
    });
    expect(
      recommendNextAction(
        OPPORTUNITY_ID,
        [sent],
        '2026-08-05T09:00:00.000Z',
      ),
    ).toMatchObject({
      code: 'follow-up-now',
    });
  });

  it('changes the next action deterministically after explicit outcomes', () => {
    const reply = recordOutcome(
      OPPORTUNITY_ID,
      {
        type: 'positive-reply',
        occurredAt: '2026-08-01T09:00:00.000Z',
        note: 'Пригласили выбрать время.',
      },
      '2026-08-01T09:05:00.000Z',
    );
    const interview = recordOutcome(
      OPPORTUNITY_ID,
      {
        type: 'interview',
        occurredAt: '2026-08-02T09:00:00.000Z',
        note: 'Интервью назначено.',
      },
      '2026-08-02T09:05:00.000Z',
    );

    expect(
      recommendNextAction(OPPORTUNITY_ID, [reply], '2026-08-02T10:00:00.000Z')
        .code,
    ).toBe('respond-now');
    expect(
      recommendNextAction(
        OPPORTUNITY_ID,
        [reply, interview],
        '2026-08-02T10:00:00.000Z',
      ).code,
    ).toBe('prepare-interview');
  });

  it('undoes without deleting history and restores the previous recommendation', () => {
    const sent = recordOutcome(
      OPPORTUNITY_ID,
      {
        type: 'contacted',
        occurredAt: '2026-07-31T09:00:00.000Z',
        note: '',
      },
      '2026-07-31T09:05:00.000Z',
    );
    const rejection = recordOutcome(
      OPPORTUNITY_ID,
      {
        type: 'negative-reply',
        occurredAt: '2026-08-01T09:00:00.000Z',
        note: 'Роль закрыта.',
      },
      '2026-08-01T09:05:00.000Z',
    );
    const history = undoOutcome(
      [sent, rejection],
      rejection.id,
      '2026-08-01T09:10:00.000Z',
    );

    expect(history).toHaveLength(2);
    expect(history[1].undoneAt).toBe('2026-08-01T09:10:00.000Z');
    expect(
      recommendNextAction(OPPORTUNITY_ID, history, '2026-08-02T09:00:00.000Z')
        .code,
    ).toBe('set-follow-up');
  });

  it('validates future events, note length and follow-up order', () => {
    expect(
      validateOutcomeInput(
        {
          type: 'applied',
          occurredAt: '2026-08-10T09:00:00.000Z',
          note: 'x'.repeat(501),
          followUpAt: '2026-08-09T09:00:00.000Z',
        },
        '2026-07-31T09:00:00.000Z',
      ),
    ).toEqual({
      occurredAt: 'Событие не может быть в будущем.',
      note: 'Сократите заметку до 500 знаков.',
      followUpAt: 'Следующий контакт не может быть раньше события.',
    });

    expect(
      validateOutcomeInput(
        {
          type: 'applied',
          occurredAt: '2026-08-01',
          note: '',
        },
        '2026-07-31T23:30:00.000Z',
      ),
    ).toMatchObject({
      occurredAt: 'Событие не может быть в будущем.',
    });
  });

  it('starts from performing the prepared action when history is empty', () => {
    expect(recommendNextAction(OPPORTUNITY_ID, [])).toEqual({
      code: 'perform-action',
      title: 'Выполнить выбранное действие',
      reason:
        'Результат ещё не записан. Используйте подготовленный пакет в официальном интерфейсе площадки.',
    });
  });
});
