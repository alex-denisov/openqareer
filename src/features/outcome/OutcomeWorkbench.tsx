import { useMemo, useState, type FormEvent } from 'react';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import {
  recommendNextAction,
  recordOutcome,
  undoOutcome,
  validateOutcomeInput,
  type OutcomeEvent,
  type OutcomeInput,
  type OutcomeInputErrors,
  type OutcomeType,
} from './outcomeEngine';

interface OutcomeWorkbenchProps {
  workspace: CandidateWorkspace;
  storageError?: string;
  onBack: () => void;
  onChange: (outcomes: OutcomeEvent[]) => void;
}

const OUTCOME_LABELS: Record<OutcomeType, string> = {
  applied: 'Отклик отправлен',
  contacted: 'Контакт отправлен',
  'positive-reply': 'Получен положительный ответ',
  'negative-reply': 'Получен отказ',
  interview: 'Интервью состоялось / назначено',
  offer: 'Получен оффер',
  withdrawn: 'Я остановил процесс',
};

export function OutcomeWorkbench({
  workspace,
  storageError,
  onBack,
  onChange,
}: OutcomeWorkbenchProps) {
  const opportunity = workspace.opportunity;
  if (!opportunity) {
    return null;
  }

  const recommendation = recommendNextAction(
    opportunity.id,
    workspace.outcomes,
  );
  const activeCount = workspace.outcomes.filter(
    (event) =>
      event.opportunityId === opportunity.id && !event.undoneAt,
  ).length;

  return (
    <main className="outcome-layout" data-testid="outcome-workbench">
      <header className="outcome-header">
        <button className="text-button" onClick={onBack}>
          ← Пакет действия
        </button>
        <div>
          <p className="eyebrow">Результат и следующий шаг</p>
          <h1>Поиск учится только на том, что произошло.</h1>
          <p>
            Запишите факт без интерпретации. Молчание не станет отказом, а
            рекомендация всегда покажет, на каком событии она основана.
          </p>
        </div>
      </header>

      {storageError ? (
        <div className="status-message status-message--error" role="alert">
          <strong>Изменения остались на экране, но не сохранились.</strong>
          <p>{storageError}</p>
        </div>
      ) : null}

      <section className="outcome-context" aria-label="Текущая возможность">
        <div>
          <p className="eyebrow">Возможность</p>
          <h2>{opportunity.title}</h2>
          <p>{opportunity.company || 'Компания не указана'}</p>
        </div>
        <dl>
          <div>
            <dt>Решение</dt>
            <dd>
              {opportunity.decision?.choice === 'network'
                ? 'Сначала контакт'
                : 'Откликаться'}
            </dd>
          </div>
          <div>
            <dt>Активных событий</dt>
            <dd>{activeCount}</dd>
          </div>
          <div>
            <dt>История</dt>
            <dd>Хранится локально</dd>
          </div>
        </dl>
      </section>

      <section className="next-action-card" aria-live="polite">
        <div className="next-action-index" aria-hidden="true">
          →
        </div>
        <div>
          <p className="eyebrow">Следующее сильное действие</p>
          <h2>{recommendation.title}</h2>
          <p>{recommendation.reason}</p>
          {recommendation.dueAt ? (
            <span>
              Контрольная дата: {formatDate(recommendation.dueAt)}
            </span>
          ) : null}
          {recommendation.sourceOutcomeId ? (
            <small>
              Основание: {recommendation.sourceOutcomeId}
            </small>
          ) : (
            <small>Основание: события пока не записаны</small>
          )}
        </div>
      </section>

      <div className="outcome-grid">
        <OutcomeForm
          defaultType={
            opportunity.decision?.choice === 'network'
              ? 'contacted'
              : 'applied'
          }
          onRecord={(input) => {
            const event = recordOutcome(opportunity.id, input);
            onChange([...workspace.outcomes, event]);
          }}
        />
        <OutcomeTimeline
          opportunityId={opportunity.id}
          events={workspace.outcomes}
          onUndo={(id) => onChange(undoOutcome(workspace.outcomes, id))}
        />
      </div>
    </main>
  );
}

function OutcomeForm({
  defaultType,
  onRecord,
}: {
  defaultType: OutcomeType;
  onRecord: (input: OutcomeInput) => void;
}) {
  const [input, setInput] = useState<OutcomeInput>({
    type: defaultType,
    occurredAt: formatDateInput(new Date()),
    note: '',
  });
  const [errors, setErrors] = useState<OutcomeInputErrors>({});
  const [saved, setSaved] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nextErrors = validateOutcomeInput(input);
    setErrors(nextErrors);
    setSaved(false);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    onRecord(input);
    setInput((current) => ({
      ...current,
      note: '',
      followUpAt: undefined,
    }));
    setSaved(true);
  }

  return (
    <form className="outcome-form" onSubmit={submit} noValidate>
      <div>
        <p className="eyebrow">Добавить факт</p>
        <h2>Что произошло?</h2>
        <p>
          В списке намеренно нет «нет ответа»: это отсутствие события, а не
          доказанный исход.
        </p>
      </div>

      <div className="field">
        <label htmlFor="outcome-type">Событие</label>
        <select
          id="outcome-type"
          value={input.type}
          onChange={(event) =>
            setInput({ ...input, type: event.target.value as OutcomeType })
          }
        >
          {(Object.keys(OUTCOME_LABELS) as OutcomeType[]).map((type) => (
            <option key={type} value={type}>
              {OUTCOME_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      <div className="outcome-date-grid">
        <div className="field">
          <label htmlFor="outcome-date">Дата события</label>
          <input
            id="outcome-date"
            type="date"
            value={input.occurredAt}
            onChange={(event) =>
              setInput({ ...input, occurredAt: event.target.value })
            }
            aria-invalid={Boolean(errors.occurredAt)}
            aria-describedby={
              errors.occurredAt ? 'outcome-date-error' : undefined
            }
          />
          {errors.occurredAt ? (
            <p className="field-error" id="outcome-date-error" role="alert">
              {errors.occurredAt}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="follow-up-date">Проверить снова</label>
          <input
            id="follow-up-date"
            type="date"
            value={input.followUpAt ?? ''}
            onChange={(event) =>
              setInput({
                ...input,
                followUpAt: event.target.value || undefined,
              })
            }
            aria-invalid={Boolean(errors.followUpAt)}
            aria-describedby={
              errors.followUpAt
                ? 'follow-up-date-error'
                : 'follow-up-date-help'
            }
          />
          {errors.followUpAt ? (
            <p className="field-error" id="follow-up-date-error" role="alert">
              {errors.followUpAt}
            </p>
          ) : (
            <p className="field-help" id="follow-up-date-help">
              Необязательно. Это не дата автоматической отправки.
            </p>
          )}
        </div>
      </div>

      <div className="field">
        <label htmlFor="outcome-note">Короткая заметка</label>
        <textarea
          id="outcome-note"
          value={input.note}
          maxLength={500}
          onChange={(event) =>
            setInput({ ...input, note: event.target.value })
          }
          aria-invalid={Boolean(errors.note)}
          aria-describedby={errors.note ? 'outcome-note-error' : 'outcome-note-help'}
          placeholder="Только наблюдаемый факт или полезный контекст."
        />
        {errors.note ? (
          <p className="field-error" id="outcome-note-error" role="alert">
            {errors.note}
          </p>
        ) : (
          <p className="field-help" id="outcome-note-help">
            {input.note.length}/500
          </p>
        )}
      </div>

      <button className="button button--primary" type="submit">
        Записать событие
        <span aria-hidden="true">→</span>
      </button>
      <p className="outcome-saved" aria-live="polite">
        {saved ? 'Событие сохранено локально.' : ''}
      </p>
    </form>
  );
}

function OutcomeTimeline({
  opportunityId,
  events,
  onUndo,
}: {
  opportunityId: string;
  events: OutcomeEvent[];
  onUndo: (id: string) => void;
}) {
  const relevant = useMemo(
    () =>
      events
        .filter((event) => event.opportunityId === opportunityId)
        .sort(
          (left, right) =>
            new Date(right.recordedAt).getTime() -
            new Date(left.recordedAt).getTime(),
        ),
    [events, opportunityId],
  );

  return (
    <section className="outcome-timeline">
      <div>
        <p className="eyebrow">История</p>
        <h2>Что меняло маршрут</h2>
      </div>
      {relevant.length > 0 ? (
        <ol>
          {relevant.map((event) => (
            <li
              key={event.id}
              className={event.undoneAt ? 'is-undone' : ''}
            >
              <span className="timeline-dot" aria-hidden="true" />
              <div>
                <time dateTime={event.occurredAt}>
                  {formatDate(event.occurredAt)}
                </time>
                <h3>{OUTCOME_LABELS[event.type]}</h3>
                {event.note ? <p>{event.note}</p> : null}
                {event.followUpAt ? (
                  <small>Проверить: {formatDate(event.followUpAt)}</small>
                ) : null}
                {event.undoneAt ? (
                  <span className="undone-label">Отменено · запись сохранена</span>
                ) : (
                  <button
                    className="text-button"
                    onClick={() => onUndo(event.id)}
                  >
                    Отменить запись
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty-timeline">
          <strong>Событий пока нет</strong>
          <p>
            После первого факта здесь появится хронология и основание
            рекомендации.
          </p>
        </div>
      )}
    </section>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
  }).format(new Date(value));
}

function formatDateInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
