import { useState } from 'react';
import {
  completeCandidateAnalysis,
  updateEvidenceItem,
  type CandidateAnalysis,
  type EvidenceItem,
  type EvidenceKind,
  type EvidenceStatus,
  type RoleFitState,
} from './evidenceEngine';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';

interface EvidenceReviewProps {
  workspace: CandidateWorkspace;
  storageError?: string;
  onBack: () => void;
  onChange: (analysis: CandidateAnalysis) => void;
  onOpenOpportunity: () => void;
}

const KIND_LABELS: Record<EvidenceKind, string> = {
  result: 'Результат',
  responsibility: 'Ответственность',
  scope: 'Масштаб',
  expertise: 'Опыт / знание',
};

const STATUS_LABELS: Record<EvidenceStatus, string> = {
  pending: 'Не проверено',
  confirmed: 'Подтверждено вами',
  rejected: 'Не использовать',
};

const FIT_LABELS: Record<RoleFitState, string> = {
  plausible: 'Есть основания',
  adjacent: 'Смежная гипотеза',
  'needs-evidence': 'Нужны доказательства',
};

export function EvidenceReview({
  workspace,
  storageError,
  onBack,
  onChange,
  onOpenOpportunity,
}: EvidenceReviewProps) {
  const [analysis, setAnalysis] = useState(() => workspace.analysis!);
  const hypothesesReady = analysis.roleHypotheses.length > 0;
  const confirmedCount = analysis.evidenceItems.filter(
    (item) => item.status === 'confirmed',
  ).length;
  const pendingCount = analysis.evidenceItems.filter(
    (item) => item.status === 'pending',
  ).length;

  function commit(nextAnalysis: CandidateAnalysis) {
    setAnalysis(nextAnalysis);
    onChange(nextAnalysis);
  }

  function updateItem(
    id: string,
    update: Partial<Pick<EvidenceItem, 'statement' | 'status'>>,
  ) {
    commit({
      ...analysis,
      evidenceItems: analysis.evidenceItems.map((item) =>
        item.id === id ? updateEvidenceItem(item, update) : item,
      ),
      roleHypotheses: [],
      reviewedAt: undefined,
    });
  }

  function buildHypotheses() {
    commit(completeCandidateAnalysis(workspace.targetDirection, analysis));
  }

  return (
    <main className="evidence-layout" data-testid="evidence-review">
      <header className="evidence-header">
        <button className="text-button" onClick={onBack}>
          ← Рабочий маршрут
        </button>
        <div className="evidence-header-copy">
          <p className="eyebrow">Проверка основания</p>
          <h1>
            {hypothesesReady
              ? 'Карта ролей и пробелов'
              : 'Сначала факты, потом роль.'}
          </h1>
          <p>
            {hypothesesReady
              ? 'Это гипотезы, а не вердикт. Каждое основание ниже связано с формулировкой, которую вы подтвердили.'
              : 'Мы выделили формулировки из резюме. Подтвердите, исправьте или исключите каждую — неподтверждённое не повлияет на роль.'}
          </p>
        </div>
        <div className="review-progress" aria-label="Прогресс проверки">
          <strong>{confirmedCount}</strong>
          <span>подтверждено</span>
          <i aria-hidden="true" />
          <strong>{pendingCount}</strong>
          <span>ждут решения</span>
        </div>
      </header>

      {storageError ? (
        <div className="status-message status-message--error" role="alert">
          <strong>Изменения остались на экране, но не сохранились.</strong>
          <p>{storageError}</p>
        </div>
      ) : null}

      {hypothesesReady ? (
        <RoleMap
          analysis={analysis}
          onOpenOpportunity={onOpenOpportunity}
          onReturnToEvidence={() =>
            commit({
              ...analysis,
              roleHypotheses: [],
              reviewedAt: undefined,
            })
          }
        />
      ) : (
        <EvidenceLedger
          analysis={analysis}
          confirmedCount={confirmedCount}
          onUpdateItem={updateItem}
          onBuild={buildHypotheses}
        />
      )}
    </main>
  );
}

function EvidenceLedger({
  analysis,
  confirmedCount,
  onUpdateItem,
  onBuild,
}: {
  analysis: CandidateAnalysis;
  confirmedCount: number;
  onUpdateItem: (
    id: string,
    update: Partial<Pick<EvidenceItem, 'statement' | 'status'>>,
  ) => void;
  onBuild: () => void;
}) {
  if (analysis.evidenceItems.length === 0) {
    return (
      <section className="evidence-empty" aria-labelledby="evidence-empty-title">
        <p className="eyebrow">Недостаточно материала</p>
        <h2 id="evidence-empty-title">Резюме не содержит проверяемых фраз.</h2>
        <p>
          Мы ничего не достраиваем за вас. Добавьте ответы на вопросы в исходные
          материалы и повторите разбор.
        </p>
        <ul>
          {analysis.questions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="evidence-workbench" aria-label="Проверка фактов">
      <div className="ledger-column">
        <div className="ledger-heading">
          <div>
            <p className="eyebrow">Evidence ledger</p>
            <h2>Формулировки из резюме</h2>
          </div>
          <span>{analysis.evidenceMethodVersion}</span>
        </div>

        <div className="evidence-list">
          {analysis.evidenceItems.map((item, index) => (
            <EvidenceCard
              key={item.id}
              item={item}
              index={index}
              onUpdate={(update) => onUpdateItem(item.id, update)}
            />
          ))}
        </div>
      </div>

      <aside className="review-rail" aria-label="Правила и следующий шаг">
        <div>
          <p className="eyebrow">Правило</p>
          <h2>Только ваше подтверждение</h2>
          <p>
            Исходная цитата остаётся неизменной. Если вы редактируете
            формулировку, она помечается как пользовательская версия.
          </p>
        </div>

        {analysis.questions.length > 0 ? (
          <div className="review-questions">
            <p className="eyebrow">Чего пока не видно</p>
            <ul>
              {analysis.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="review-cta">
          <strong>{confirmedCount}</strong>
          <p>{formatConfirmedCount(confirmedCount)}</p>
          <button
            className="button button--primary"
            onClick={onBuild}
            disabled={confirmedCount === 0}
          >
            Построить гипотезы
            <span aria-hidden="true">→</span>
          </button>
          {confirmedCount === 0 ? (
            <span>Подтвердите хотя бы одну формулировку.</span>
          ) : (
            <span>Непроверенные и отклонённые фразы не используются.</span>
          )}
        </div>
      </aside>
    </section>
  );
}

function formatConfirmedCount(count: number): string {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return 'подтверждённых фактов';
  }
  if (lastDigit === 1) {
    return 'подтверждённый факт';
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return 'подтверждённых факта';
  }
  return 'подтверждённых фактов';
}

function EvidenceCard({
  item,
  index,
  onUpdate,
}: {
  item: EvidenceItem;
  index: number;
  onUpdate: (
    update: Partial<Pick<EvidenceItem, 'statement' | 'status'>>,
  ) => void;
}) {
  const statementInvalid = item.statement.trim().length < 10;

  return (
    <article
      className={`evidence-card evidence-card--${item.status}`}
      data-testid={`evidence-item-${item.id}`}
    >
      <div className="evidence-meta">
        <span>{String(index + 1).padStart(2, '0')}</span>
        <span>{KIND_LABELS[item.kind]}</span>
        <span>{STATUS_LABELS[item.status]}</span>
      </div>
      <div className="evidence-source">
        <span>Источник · импортированное резюме</span>
        <blockquote>«{item.sourceExcerpt}»</blockquote>
      </div>
      <div className="field evidence-statement">
        <label htmlFor={`${item.id}-statement`}>Проверяемая формулировка</label>
        <textarea
          id={`${item.id}-statement`}
          value={item.statement}
          onChange={(event) => onUpdate({ statement: event.target.value })}
          aria-invalid={statementInvalid}
          aria-describedby={
            statementInvalid
              ? `${item.id}-statement-error`
              : item.userEdited
                ? `${item.id}-statement-help`
                : undefined
          }
          rows={3}
        />
        {statementInvalid ? (
          <p className="field-error" id={`${item.id}-statement-error`}>
            Оставьте проверяемую формулировку или исключите этот пункт.
          </p>
        ) : item.userEdited ? (
          <p className="field-help" id={`${item.id}-statement-help`}>
            Отредактировано вами · источник сохранён
          </p>
        ) : null}
      </div>
      <div className="evidence-actions">
        <button
          className={
            item.status === 'rejected'
              ? 'decision-button is-selected'
              : 'decision-button'
          }
          onClick={() => onUpdate({ status: 'rejected' })}
          aria-pressed={item.status === 'rejected'}
        >
          Не использовать
        </button>
        <button
          className={
            item.status === 'confirmed'
              ? 'decision-button decision-button--confirm is-selected'
              : 'decision-button decision-button--confirm'
          }
          onClick={() => onUpdate({ status: 'confirmed' })}
          aria-pressed={item.status === 'confirmed'}
          disabled={statementInvalid}
        >
          Подтверждаю
        </button>
      </div>
    </article>
  );
}

function RoleMap({
  analysis,
  onReturnToEvidence,
  onOpenOpportunity,
}: {
  analysis: CandidateAnalysis;
  onReturnToEvidence: () => void;
  onOpenOpportunity: () => void;
}) {
  const evidenceById = new Map(
    analysis.evidenceItems.map((item) => [item.id, item]),
  );

  return (
    <section className="role-map" aria-label="Гипотезы ролей">
      <div className="role-map-heading">
        <div>
          <p className="eyebrow">2–4 направления для проверки</p>
          <h2>Не рейтинг. Не обещание. Рабочие гипотезы.</h2>
        </div>
        <button className="button button--quiet" onClick={onReturnToEvidence}>
          ← Вернуться к фактам
        </button>
      </div>

      <div className="hypothesis-list">
        {analysis.roleHypotheses.map((hypothesis, index) => (
          <article className="hypothesis-card" key={hypothesis.id}>
            <div className="hypothesis-index">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <span className={`fit-state fit-state--${hypothesis.fitState}`}>
                {FIT_LABELS[hypothesis.fitState]}
              </span>
            </div>
            <h3>{hypothesis.title}</h3>
            <p>{hypothesis.basis}</p>

            <div className="hypothesis-section">
              <span>Основания</span>
              {hypothesis.evidenceIds.length > 0 ? (
                <ul>
                  {hypothesis.evidenceIds.map((id) => (
                    <li key={id}>
                      <strong>{id.toUpperCase()}</strong>
                      {evidenceById.get(id)?.statement}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Подтверждённых оснований пока нет.</p>
              )}
            </div>

            <div className="hypothesis-section hypothesis-section--gaps">
              <span>Что проверить</span>
              <ul>
                {hypothesis.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>

      <div className="market-next-step">
        <div>
          <p className="eyebrow">Следующее сильное действие</p>
          <h2>Проверить эти роли на реальных вакансиях</h2>
          <p>
            Следующий срез сравнит повторяющиеся задачи рынка с подтверждёнными
            фактами и покажет fit, gaps и жёсткие ограничения без единого балла.
          </p>
        </div>
        <button
          className="button button--primary"
          onClick={onOpenOpportunity}
        >
          Добавить вакансию
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
