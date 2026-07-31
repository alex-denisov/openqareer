import { useState, type ChangeEvent, type FormEvent } from 'react';
import {
  analyzeOpportunity,
  createOpportunityRecord,
  recordOpportunityDecision,
  validateOpportunityInput,
  type HardConstraintAssessment,
  type OpportunityChoice,
  type OpportunityInput,
  type OpportunityInputErrors,
  type OpportunityItem,
  type OpportunityRecord,
} from './opportunityEngine';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';

interface OpportunityWorkbenchProps {
  workspace: CandidateWorkspace;
  storageError?: string;
  onBack: () => void;
  onChange: (opportunity: OpportunityRecord) => void;
  onOpenActionPackage: () => void;
}

const EMPTY_INPUT: OpportunityInput = {
  title: '',
  company: '',
  text: '',
  sourceLabel: 'Ручной ввод',
};

const KIND_LABELS = {
  task: 'Задачи',
  requirement: 'Требования',
  condition: 'Условия',
} as const;

const CHOICE_LABELS: Record<OpportunityChoice, string> = {
  apply: 'Откликаться',
  network: 'Сначала контакт',
  watch: 'Наблюдать',
  skip: 'Пропустить',
};

const REASON_LABELS: Record<string, string> = {
  'hard-constraint-conflict': 'Подтверждён конфликт с жёстким ограничением.',
  'hard-constraints-unverified': 'Жёсткие ограничения ещё не проверены.',
  'requirements-covered-by-confirmed-evidence':
    'Все распознанные требования покрыты подтверждёнными фактами.',
  'partial-evidence-needs-role-context':
    'Есть часть оснований, но остаются gaps или нужен контекст роли.',
  'insufficient-confirmed-evidence':
    'Подтверждённых оснований пока недостаточно.',
};

export function OpportunityWorkbench({
  workspace,
  storageError,
  onBack,
  onChange,
  onOpenActionPackage,
}: OpportunityWorkbenchProps) {
  return (
    <main className="opportunity-layout" data-testid="opportunity-workbench">
      <header className="opportunity-header">
        <button className="text-button" onClick={onBack}>
          ← Рабочий маршрут
        </button>
        <div>
          <p className="eyebrow">Одна реальная возможность</p>
          <h1>
            {workspace.opportunity
              ? 'Решение по вакансии'
              : 'Проверим вакансию до отклика.'}
          </h1>
          <p>
            Текст разбирается локально. Мы отделяем совпадения, gaps,
            ограничения и неизвестное — без «процента успеха».
          </p>
        </div>
      </header>

      {storageError ? (
        <div className="status-message status-message--error" role="alert">
          <strong>Изменения остались на экране, но не сохранились.</strong>
          <p>{storageError}</p>
        </div>
      ) : null}

      {workspace.opportunity ? (
        <OpportunityReview
          workspace={workspace}
          record={workspace.opportunity}
          onChange={onChange}
          onOpenActionPackage={onOpenActionPackage}
        />
      ) : (
        <OpportunityIntake
          evidenceCount={
            workspace.analysis?.evidenceItems.filter(
              (item) => item.status === 'confirmed',
            ).length ?? 0
          }
          onCreate={(input) => {
            const record = createOpportunityRecord(input);
            onChange({
              ...record,
              analysis: analyzeOpportunity(
                record,
                workspace.analysis?.evidenceItems ?? [],
                'unknown',
              ),
            });
          }}
        />
      )}
    </main>
  );
}

function OpportunityIntake({
  evidenceCount,
  onCreate,
}: {
  evidenceCount: number;
  onCreate: (input: OpportunityInput) => void;
}) {
  const [input, setInput] = useState<OpportunityInput>(EMPTY_INPUT);
  const [errors, setErrors] = useState<OpportunityInputErrors>({});
  const [fileError, setFileError] = useState<string>();

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (
      file.size > 1024 * 1024 ||
      (!file.name.toLowerCase().endsWith('.txt') &&
        !file.name.toLowerCase().endsWith('.md') &&
        file.type !== 'text/plain' &&
        file.type !== 'text/markdown')
    ) {
      setFileError('Выберите текстовый .txt или .md файл размером до 1 МБ.');
      return;
    }

    const text = await file.text();
    setInput((current) => ({
      ...current,
      text,
      sourceLabel: `Локальный файл: ${file.name}`,
    }));
    setFileError(undefined);
    setErrors((current) => ({ ...current, text: undefined }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateOpportunityInput(input);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const firstField = [
        ['title', 'opportunity-title'],
        ['text', 'opportunity-text'],
        ['sourceUrl', 'opportunity-url'],
      ].find(([key]) =>
        Boolean(nextErrors[key as keyof OpportunityInputErrors]),
      );
      requestAnimationFrame(() => {
        if (firstField) {
          document.getElementById(firstField[1])?.focus();
        }
      });
      return;
    }
    onCreate(input);
  }

  return (
    <section className="opportunity-intake-grid">
      <aside className="opportunity-intro-panel">
        <p className="eyebrow">Что уже есть</p>
        <strong>{evidenceCount}</strong>
        <span>подтверждённых факта</span>
        <p>
          Положительное совпадение появится только тогда, когда требование
          связано хотя бы с одним из этих фактов.
        </p>
        <div>
          <span>Источник вакансии</span>
          <p>Ссылка используется как подпись. Сервис не открывает её сам.</p>
        </div>
        <div>
          <span>Свежесть</span>
          <p>Останется неизвестной, если дата не указана в тексте.</p>
        </div>
      </aside>

      <form className="opportunity-form" onSubmit={handleSubmit} noValidate>
        <div className="form-row">
          <div className="field">
            <label htmlFor="opportunity-title">Название роли</label>
            <input
              id="opportunity-title"
              value={input.title}
              onChange={(event) =>
                setInput({ ...input, title: event.target.value })
              }
              aria-invalid={Boolean(errors.title)}
              aria-describedby={
                errors.title ? 'opportunity-title-error' : undefined
              }
              placeholder="Как написано в вакансии"
            />
            {errors.title ? (
              <p className="field-error" id="opportunity-title-error">
                {errors.title}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="opportunity-company">Компания</label>
            <input
              id="opportunity-company"
              value={input.company}
              onChange={(event) =>
                setInput({ ...input, company: event.target.value })
              }
              placeholder="Если указана"
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="opportunity-url">Ссылка на источник</label>
          <input
            id="opportunity-url"
            type="url"
            value={input.sourceUrl ?? ''}
            onChange={(event) =>
              setInput({ ...input, sourceUrl: event.target.value })
            }
            aria-invalid={Boolean(errors.sourceUrl)}
            aria-describedby={
              errors.sourceUrl ? 'opportunity-url-error' : undefined
            }
            placeholder="https://… · необязательно"
          />
          {errors.sourceUrl ? (
            <p className="field-error" id="opportunity-url-error">
              {errors.sourceUrl}
            </p>
          ) : null}
        </div>

        <div className="field opportunity-text-field">
          <div className="field-heading">
            <label htmlFor="opportunity-text">Полный текст вакансии</label>
            <span>{input.text.trim().length} знаков</span>
          </div>
          <textarea
            id="opportunity-text"
            value={input.text}
            onChange={(event) =>
              setInput({
                ...input,
                text: event.target.value,
                sourceLabel: 'Ручной ввод',
              })
            }
            aria-invalid={Boolean(errors.text)}
            aria-describedby={
              errors.text ? 'opportunity-text-error' : 'opportunity-text-help'
            }
            placeholder="Вставьте задачи, требования и условия целиком."
          />
          {errors.text ? (
            <p className="field-error" id="opportunity-text-error">
              {errors.text}
            </p>
          ) : (
            <p className="field-help" id="opportunity-text-help">
              Форматировать текст вручную не нужно.
            </p>
          )}
        </div>

        <div className="local-text-file">
          <input
            id="opportunity-file"
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            onChange={handleFile}
          />
          <label htmlFor="opportunity-file">Или выбрать .txt / .md файл</label>
          <span>{input.sourceLabel}</span>
        </div>
        {fileError ? (
          <p className="field-error" role="alert">
            {fileError}
          </p>
        ) : null}

        <div className="form-footer">
          <p>Никаких входов в hh.ru, LinkedIn или другие площадки.</p>
          <button className="button button--primary" type="submit">
            Разобрать вакансию
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
    </section>
  );
}

function OpportunityReview({
  workspace,
  record,
  onChange,
  onOpenActionPackage,
}: {
  workspace: CandidateWorkspace;
  record: OpportunityRecord;
  onChange: (record: OpportunityRecord) => void;
  onOpenActionPackage: () => void;
}) {
  const [choice, setChoice] = useState<OpportunityChoice | undefined>(
    record.decision?.choice,
  );
  const [reason, setReason] = useState(record.decision?.reason ?? '');
  const [decisionError, setDecisionError] = useState<string>();
  const analysis =
    record.analysis ??
    analyzeOpportunity(
      record,
      workspace.analysis?.evidenceItems ?? [],
      'unknown',
    );
  const itemById = new Map(record.parsed.items.map((item) => [item.id, item]));
  const evidenceById = new Map(
    (workspace.analysis?.evidenceItems ?? []).map((item) => [item.id, item]),
  );

  function setHardConstraint(value: HardConstraintAssessment) {
    onChange({
      ...record,
      analysis: analyzeOpportunity(
        record,
        workspace.analysis?.evidenceItems ?? [],
        value,
      ),
      decision: undefined,
    });
  }

  function saveDecision() {
    if (!choice) {
      setDecisionError('Выберите итоговое действие.');
      return;
    }
    try {
      onChange(
        recordOpportunityDecision(
          { ...record, analysis },
          choice,
          reason,
        ),
      );
      setDecisionError(undefined);
    } catch (error) {
      setDecisionError(
        error instanceof Error ? error.message : 'Не удалось сохранить решение.',
      );
    }
  }

  return (
    <section className="opportunity-review">
      <div className="opportunity-source-card">
        <div>
          <p className="eyebrow">Источник зафиксирован</p>
          <h2>{record.title}</h2>
          <p>{record.company || 'Компания не указана'}</p>
        </div>
        <dl>
          <div>
            <dt>Получено</dt>
            <dd>{formatCapturedAt(record.capturedAt)}</dd>
          </div>
          <div>
            <dt>Источник</dt>
            <dd>{record.sourceLabel}</dd>
          </div>
          <div>
            <dt>Ссылка</dt>
            <dd>{record.sourceUrl ?? 'Не указана'}</dd>
          </div>
        </dl>
      </div>

      <div className="opportunity-content-grid">
        <div className="vacancy-structure">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Структура вакансии</p>
              <h2>Что написано в источнике</h2>
            </div>
            <span>{record.parsed.methodVersion}</span>
          </div>
          {(['task', 'requirement', 'condition'] as const).map((kind) => (
            <OpportunityItemGroup
              key={kind}
              kind={kind}
              items={record.parsed.items.filter((item) => item.kind === kind)}
            />
          ))}
        </div>

        <aside className="constraint-check">
          <p className="eyebrow">Жёсткие ограничения</p>
          <h2>Есть прямой конфликт?</h2>
          <p>
            Ваше ограничение: <strong>{workspace.constraints || 'не задано'}</strong>
          </p>
          <div className="constraint-options">
            {(
              [
                ['clear', 'Конфликта нет'],
                ['conflict', 'Есть конфликт'],
                ['unknown', 'Пока неясно'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={
                  analysis.hardConstraintAssessment === value
                    ? 'constraint-button is-selected'
                    : 'constraint-button'
                }
                onClick={() => setHardConstraint(value)}
                aria-pressed={analysis.hardConstraintAssessment === value}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="constraint-note">
            Автоматически угадывать конфликт по свободному тексту небезопасно,
            поэтому это решение подтверждаете вы.
          </p>
        </aside>
      </div>

      <div className="fit-grid">
        <section className="fit-panel fit-panel--matches">
          <p className="eyebrow">Подтверждённые совпадения</p>
          <h2>{analysis.matches.length}</h2>
          {analysis.matches.length > 0 ? (
            <ul>
              {analysis.matches.map((match) => (
                <li key={match.opportunityItemId}>
                  <strong>
                    {itemById.get(match.opportunityItemId)?.sourceExcerpt}
                  </strong>
                  <span>
                    {match.evidenceIds
                      .map((id) => evidenceById.get(id)?.statement)
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Лексических связей с подтверждёнными фактами не найдено.</p>
          )}
        </section>

        <section className="fit-panel fit-panel--gaps">
          <p className="eyebrow">Gaps</p>
          <h2>{analysis.gapItemIds.length}</h2>
          {analysis.gapItemIds.length > 0 ? (
            <ul>
              {analysis.gapItemIds.map((id) => (
                <li key={id}>{itemById.get(id)?.sourceExcerpt}</li>
              ))}
            </ul>
          ) : (
            <p>Непокрытых распознанных требований нет.</p>
          )}
        </section>

        <section className="fit-panel fit-panel--unknowns">
          <p className="eyebrow">Неизвестно</p>
          <h2>{analysis.unknowns.length}</h2>
          <ul>
            {analysis.unknowns.map((unknown) => (
              <li key={unknown}>{unknown}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="decision-panel">
        <div className="recommendation-block">
          <p className="eyebrow">Рекомендованное следующее действие</p>
          <h2>{CHOICE_LABELS[analysis.recommendation]}</h2>
          <ul>
            {analysis.reasonCodes.map((code) => (
              <li key={code}>{REASON_LABELS[code] ?? code}</li>
            ))}
          </ul>
          <p>
            Это правило текущего локального метода, а не вероятность интервью.
          </p>
        </div>

        <div className="decision-form">
          <p className="eyebrow">Ваше решение</p>
          <div className="decision-choice-grid">
            {(Object.keys(CHOICE_LABELS) as OpportunityChoice[]).map(
              (option) => (
                <button
                  key={option}
                  className={
                    choice === option
                      ? 'decision-choice is-selected'
                      : 'decision-choice'
                  }
                  onClick={() => setChoice(option)}
                  aria-pressed={choice === option}
                >
                  {CHOICE_LABELS[option]}
                </button>
              ),
            )}
          </div>
          <div className="field">
            <label htmlFor="decision-reason">Почему вы выбираете это?</label>
            <textarea
              id="decision-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={Boolean(decisionError)}
              aria-describedby={
                decisionError ? 'decision-error' : 'decision-help'
              }
              placeholder="Короткая причина поможет улучшать следующие решения."
            />
            {decisionError ? (
              <p className="field-error" id="decision-error" role="alert">
                {decisionError}
              </p>
            ) : (
              <p className="field-help" id="decision-help">
                Решение ничего не отправляет на площадку.
              </p>
            )}
          </div>
          <button
            className="button button--primary"
            onClick={saveDecision}
          >
            Сохранить решение
            <span aria-hidden="true">→</span>
          </button>
          {record.decision ? (
            <div className="saved-decision" role="status">
              <strong>
                Сохранено: {CHOICE_LABELS[record.decision.choice]}
              </strong>
              <span>
                {record.decision.overridesRecommendation
                  ? 'Ваш выбор отличается от рекомендации.'
                  : 'Ваш выбор совпадает с рекомендацией.'}
              </span>
              {record.decision.choice === 'apply' ||
              record.decision.choice === 'network' ? (
                <button
                  className="button button--primary saved-decision-action"
                  onClick={onOpenActionPackage}
                >
                  Собрать пакет действия
                  <span aria-hidden="true">→</span>
                </button>
              ) : (
                <span>
                  Пакет не нужен для решения «
                  {CHOICE_LABELS[record.decision.choice]}».
                </span>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function OpportunityItemGroup({
  kind,
  items,
}: {
  kind: OpportunityItem['kind'];
  items: OpportunityItem[];
}) {
  return (
    <div className="opportunity-item-group">
      <h3>{KIND_LABELS[kind]}</h3>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.id.toUpperCase()}</span>
              <p>{item.sourceExcerpt}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p>Не удалось надёжно выделить из текста.</p>
      )}
    </div>
  );
}

function formatCapturedAt(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
