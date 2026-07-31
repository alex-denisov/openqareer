export const OUTCOME_METHOD_VERSION = 'outcome-loop-local-v1';

export type OutcomeType =
  | 'applied'
  | 'contacted'
  | 'positive-reply'
  | 'negative-reply'
  | 'interview'
  | 'offer'
  | 'withdrawn';

export interface OutcomeEvent {
  id: string;
  methodVersion: typeof OUTCOME_METHOD_VERSION;
  opportunityId: string;
  type: OutcomeType;
  occurredAt: string;
  recordedAt: string;
  note: string;
  followUpAt?: string;
  undoneAt?: string;
}

export interface OutcomeInput {
  type: OutcomeType;
  occurredAt: string;
  note: string;
  followUpAt?: string;
}

export interface OutcomeInputErrors {
  occurredAt?: string;
  note?: string;
  followUpAt?: string;
}

export type NextActionCode =
  | 'perform-action'
  | 'set-follow-up'
  | 'wait-until-follow-up'
  | 'follow-up-now'
  | 'respond-now'
  | 'prepare-interview'
  | 'evaluate-offer'
  | 'review-and-search'
  | 'restart-search';

export interface NextActionRecommendation {
  code: NextActionCode;
  title: string;
  reason: string;
  dueAt?: string;
  sourceOutcomeId?: string;
}

export function validateOutcomeInput(
  input: OutcomeInput,
  now: string = new Date().toISOString(),
): OutcomeInputErrors {
  const errors: OutcomeInputErrors = {};
  const occurredAt = parseDate(input.occurredAt);
  const current = parseDate(now);

  if (!occurredAt) {
    errors.occurredAt = 'Укажите дату события.';
  } else if (current && occurredAt.getTime() > current.getTime()) {
    errors.occurredAt = 'Событие не может быть в будущем.';
  }

  if (input.note.trim().length > 500) {
    errors.note = 'Сократите заметку до 500 знаков.';
  }

  if (input.followUpAt) {
    const followUpAt = parseDate(input.followUpAt);
    if (!followUpAt) {
      errors.followUpAt = 'Проверьте дату следующего контакта.';
    } else if (
      occurredAt &&
      followUpAt.getTime() < occurredAt.getTime()
    ) {
      errors.followUpAt = 'Следующий контакт не может быть раньше события.';
    }
  }

  return errors;
}

export function recordOutcome(
  opportunityId: string,
  input: OutcomeInput,
  recordedAt: string = new Date().toISOString(),
): OutcomeEvent {
  const errors = validateOutcomeInput(input, recordedAt);
  if (Object.keys(errors).length > 0) {
    throw new Error(Object.values(errors)[0]);
  }

  return {
    id: `outcome-${recordedAt}`,
    methodVersion: OUTCOME_METHOD_VERSION,
    opportunityId,
    type: input.type,
    occurredAt: new Date(input.occurredAt).toISOString(),
    recordedAt,
    note: input.note.trim(),
    followUpAt: input.followUpAt
      ? new Date(input.followUpAt).toISOString()
      : undefined,
  };
}

export function undoOutcome(
  history: OutcomeEvent[],
  outcomeId: string,
  undoneAt: string = new Date().toISOString(),
): OutcomeEvent[] {
  return history.map((event) =>
    event.id === outcomeId && !event.undoneAt
      ? { ...event, undoneAt }
      : event,
  );
}

export function recommendNextAction(
  opportunityId: string,
  history: OutcomeEvent[],
  now: string = new Date().toISOString(),
): NextActionRecommendation {
  const active = history
    .filter(
      (event) =>
        event.opportunityId === opportunityId && event.undoneAt === undefined,
    )
    .sort(
      (left, right) =>
        new Date(right.occurredAt).getTime() -
          new Date(left.occurredAt).getTime() ||
        new Date(right.recordedAt).getTime() -
          new Date(left.recordedAt).getTime(),
    );
  const latest = active[0];

  if (!latest) {
    return {
      code: 'perform-action',
      title: 'Выполнить выбранное действие',
      reason:
        'Результат ещё не записан. Используйте подготовленный пакет в официальном интерфейсе площадки.',
    };
  }

  switch (latest.type) {
    case 'offer':
      return fromOutcome(latest, {
        code: 'evaluate-offer',
        title: 'Проверить оффер по вашим критериям',
        reason:
          'Оффер записан как факт. Следующий шаг — сравнить условия, риски и ограничения до ответа.',
      });
    case 'interview':
      return fromOutcome(latest, {
        code: 'prepare-interview',
        title: 'Подготовиться к следующему этапу',
        reason:
          'Интервью подтверждено. Соберите примеры по требованиям и вопросы к команде.',
      });
    case 'positive-reply':
      return fromOutcome(latest, {
        code: 'respond-now',
        title: 'Ответить и закрепить следующий шаг',
        reason:
          'Положительный ответ уже получен. Не оставляйте договорённость без даты или формата.',
      });
    case 'negative-reply':
      return fromOutcome(latest, {
        code: 'review-and-search',
        title: 'Зафиксировать вывод и перейти к следующей вакансии',
        reason:
          'Отказ записан явно. Это результат одной возможности, а не оценка вашей роли в целом.',
      });
    case 'withdrawn':
      return fromOutcome(latest, {
        code: 'restart-search',
        title: 'Вернуться к очереди возможностей',
        reason:
          'Процесс остановлен вами. Сохраните причину как ограничение для следующих решений.',
      });
    case 'applied':
    case 'contacted':
      return recommendAfterSent(latest, now);
  }
}

function recommendAfterSent(
  latest: OutcomeEvent,
  now: string,
): NextActionRecommendation {
  if (!latest.followUpAt) {
    return fromOutcome(latest, {
      code: 'set-follow-up',
      title: 'Назначить дату проверки ответа',
      reason:
        'Действие выполнено, но дата следующей проверки не задана. Отсутствие ответа ещё не является отказом.',
    });
  }

  const followUpAt = new Date(latest.followUpAt).getTime();
  const current = new Date(now).getTime();
  if (followUpAt <= current) {
    return fromOutcome(latest, {
      code: 'follow-up-now',
      title: 'Проверить статус и сделать один follow-up',
      reason:
        'Наступила выбранная вами дата проверки. Сначала проверьте площадку, затем решите, уместен ли один контакт.',
      dueAt: latest.followUpAt,
    });
  }

  return fromOutcome(latest, {
    code: 'wait-until-follow-up',
    title: 'Ждать до выбранной даты проверки',
    reason:
      'Действие уже выполнено. До контрольной даты отсутствие ответа остаётся неизвестным результатом.',
    dueAt: latest.followUpAt,
  });
}

function fromOutcome(
  event: OutcomeEvent,
  recommendation: Omit<NextActionRecommendation, 'sourceOutcomeId'>,
): NextActionRecommendation {
  return {
    ...recommendation,
    sourceOutcomeId: event.id,
  };
}

function parseDate(value: string): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
