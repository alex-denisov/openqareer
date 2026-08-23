import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  Check,
  Compass,
  Sparkle,
} from '@phosphor-icons/react';
import {
  type EvidenceItem,
} from '../../evidence/evidenceEngine';
import {
  analyzeOpportunity,
  createOpportunityRecord,
  recordOpportunityDecision,
  type OpportunityChoice,
} from '../../opportunity/opportunityEngine';
import {
  composeMessage,
  createActionPackage,
  getActionChecklist,
} from '../../action/actionPackageEngine';
import {
  recommendNextAction,
  recordOutcome,
  type OutcomeType,
} from '../../outcome/outcomeEngine';

import { JourneyViewProps, SourceCapability, ViewHeader } from './_shared';
export function OpportunitiesView({
  workspace,
  journey,
  onNavigate,
  onOpenExpert,
  onUpdateWorkspace,
}: JourneyViewProps) {
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [text, setText] = useState('');
  const [decisionReason, setDecisionReason] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const opportunity = workspace.opportunity;
  const decisionLabel = useMemo(() => {
    const value =
      opportunity?.decision?.choice ?? opportunity?.analysis?.recommendation;
    if (value === 'apply') return 'Откликаться';
    if (value === 'network') return 'Сначала найти контакт';
    if (value === 'watch') return 'Наблюдать';
    if (value === 'skip') return 'Пропустить';
    return null;
  }, [opportunity]);
  const comparisonRows = useMemo(() => {
    if (!opportunity?.analysis) return [];
    const evidence = new Map(
      (workspace.analysis?.evidenceItems ?? []).map((item) => [item.id, item]),
    );
    const matches = new Map(
      opportunity.analysis.matches.map((match) => [
        match.opportunityItemId,
        match,
      ]),
    );
    const gapIds = new Set(opportunity.analysis.gapItemIds);

    return opportunity.parsed.items.map((item) => {
      const match = matches.get(item.id);
      return {
        item,
        evidence: (match?.evidenceIds ?? [])
          .map((id) => evidence.get(id))
          .filter((value): value is EvidenceItem => value !== undefined),
        state: match
          ? ('matched' as const)
          : gapIds.has(item.id)
            ? ('gap' as const)
            : ('unknown' as const),
      };
    });
  }, [opportunity, workspace.analysis]);
  const activeOutcomes = useMemo(
    () =>
      opportunity
        ? workspace.outcomes.filter(
            (event) =>
              event.opportunityId === opportunity.id &&
              event.undoneAt === undefined,
          )
        : [],
    [opportunity, workspace.outcomes],
  );
  const outcomeNextAction = useMemo(
    () =>
      opportunity
        ? recommendNextAction(opportunity.id, workspace.outcomes)
        : undefined,
    [opportunity, workspace.outcomes],
  );

  function analyze() {
    if (title.trim().length < 2 || company.trim().length < 2 || text.trim().length < 80) {
      return;
    }
    const record = createOpportunityRecord({
      title,
      company,
      text,
      sourceLabel: 'Добавлено кандидатом',
    });
    const analyzed = workspace.analysis
      ? {
          ...record,
          analysis: analyzeOpportunity(
            record,
            workspace.analysis.evidenceItems,
            'unknown',
          ),
        }
      : record;
    onUpdateWorkspace({
      ...workspace,
      opportunity: analyzed,
      actionPackage: undefined,
      outcomes: [],
      updatedAt: new Date().toISOString(),
    });
  }

  function decide(choice: OpportunityChoice) {
    if (
      !opportunity?.analysis ||
      !workspace.analysis ||
      decisionReason.trim().length < 10
    ) {
      return;
    }
    const decided = recordOpportunityDecision(
      { ...opportunity, analysis: opportunity.analysis },
      choice,
      decisionReason,
    );
    const actionPackage =
      choice === 'apply' || choice === 'network'
        ? createActionPackage(
            decided,
            workspace.analysis.evidenceItems,
            workspace.targetDirection,
          )
        : undefined;
    onUpdateWorkspace({
      ...workspace,
      opportunity: decided,
      actionPackage,
      outcomes: [],
      updatedAt: new Date().toISOString(),
    });
  }

  function resetOpportunity() {
    setTitle('');
    setCompany('');
    setText('');
    setDecisionReason('');
    onUpdateWorkspace({
      ...workspace,
      opportunity: undefined,
      actionPackage: undefined,
      outcomes: [],
      updatedAt: new Date().toISOString(),
    });
  }

  function addOutcome(type: OutcomeType, followUpAt?: string) {
    if (!opportunity) return;
    const now = new Date().toISOString();
    const event = recordOutcome(
      opportunity.id,
      {
        type,
        occurredAt: now,
        note: outcomeNote(type),
        followUpAt,
      },
      now,
    );
    onUpdateWorkspace({
      ...workspace,
      outcomes: [...workspace.outcomes, event],
      updatedAt: now,
    });
  }

  return (
    <div className="career-view career-opportunities-view">
      <ViewHeader
        eyebrow="Вакансии, компании, контакты"
        title="Возможности"
        action="Настроить со стратегом"
        onAction={onOpenExpert}
      />

      {!opportunity ? (
        <div className="career-opportunity-start">
          <section>
            <Compass size={28} />
            <h2>Начнём с одной реальной вакансии</h2>
            <p>
              Это ещё не анализ рынка. Одна вакансия покажет, какие факты
              профиля работают, что неизвестно и какой маршрут действия разумен.
            </p>
          </section>
          <div className="career-opportunity-form">
            <label>
              <span>Название роли</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              <span>Компания</span>
              <input value={company} onChange={(event) => setCompany(event.target.value)} />
            </label>
            <label className="career-field-wide">
              <span>Текст вакансии</span>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={8}
                placeholder="Вставьте задачи, требования и условия. Текст обрабатывается как данные, а не как инструкции для AI."
              />
            </label>
            <button
              className="career-primary-button"
              type="button"
              disabled={title.trim().length < 2 || company.trim().length < 2 || text.trim().length < 80}
              onClick={analyze}
            >
              Проверить возможность
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      ) : (
        <section className="career-opportunity-result">
          <div className="career-opportunity-title">
            <Briefcase size={24} />
            <div>
              <p>{opportunity.company}</p>
              <h2>{opportunity.title}</h2>
            </div>
            {decisionLabel ? <span>{decisionLabel}</span> : null}
          </div>
          <div className="career-opportunity-reasons">
            <div>
              <span>Совпало</span>
              <strong>{opportunity.analysis?.matches.length ?? 0} требований</strong>
            </div>
            <div>
              <span>Пробелы</span>
              <strong>{opportunity.analysis?.gapItemIds.length ?? 0}</strong>
            </div>
            <div>
              <span>Неизвестно</span>
              <strong>{opportunity.analysis?.unknowns.length ?? 0}</strong>
            </div>
          </div>
          {opportunity.analysis ? (
            <div className="career-opportunity-explanation">
              <section className="career-opportunity-route">
                <p className="career-eyebrow">Рекомендация, а не решение за вас</p>
                <h3>Почему такой маршрут</h3>
                <p>
                  {explainOpportunityRecommendation(
                    opportunity.analysis.recommendation,
                  )}
                </p>
              </section>

              <section aria-labelledby="opportunity-comparison-title">
                <div className="career-section-heading">
                  <div>
                    <p className="career-eyebrow">Вакансия ↔ профиль</p>
                    <h3 id="opportunity-comparison-title">
                      Что подтверждено, а что ещё нет
                    </h3>
                  </div>
                </div>
                <div className="career-opportunity-comparison">
                  {comparisonRows.map(({ item, evidence, state }) => (
                    <article key={item.id} data-state={state}>
                      <div>
                        <small>{opportunityItemLabel(item.kind)}</small>
                        <p>{item.sourceExcerpt}</p>
                      </div>
                      <div className="career-opportunity-support">
                        <strong>
                          {state === 'matched'
                            ? 'Есть опора в профиле'
                            : state === 'gap'
                              ? 'Нужно подтвердить'
                              : 'Нужно проверить'}
                        </strong>
                        {evidence.map((itemEvidence) => (
                          <span key={itemEvidence.id}>
                            {itemEvidence.statement}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              {opportunity.analysis.unknowns.length > 0 ? (
                <section className="career-opportunity-unknowns">
                  <p className="career-eyebrow">Неизвестно из вакансии</p>
                  <ul>
                    {opportunity.analysis.unknowns.map((unknown) => (
                      <li key={unknown}>{unknown}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {!opportunity.decision ? (
                <section className="career-opportunity-decision">
                  <p className="career-eyebrow">Контроль остаётся у кандидата</p>
                  <h3>Принять решение</h3>
                  <label>
                    <span>Почему это разумный следующий шаг?</span>
                    <textarea
                      value={decisionReason}
                      onChange={(event) => setDecisionReason(event.target.value)}
                      rows={3}
                      placeholder="Например: сначала уточню scope роли и формат работы у команды."
                    />
                  </label>
                  <div className="career-opportunity-choices">
                    {(['apply', 'network', 'watch', 'skip'] as const).map(
                      (choice) => (
                        <button
                          key={choice}
                          type="button"
                          disabled={decisionReason.trim().length < 10}
                          className={
                            opportunity.analysis?.recommendation === choice
                              ? 'is-recommended'
                              : undefined
                          }
                          onClick={() => decide(choice)}
                        >
                          {opportunityChoiceLabel(choice)}
                          {opportunity.analysis?.recommendation === choice ? (
                            <small>Рекомендуется</small>
                          ) : null}
                        </button>
                      ),
                    )}
                  </div>
                </section>
              ) : (
                <section className="career-opportunity-saved-decision">
                  <div>
                    <p className="career-eyebrow">Решение сохранено</p>
                    <h3>{opportunityChoiceLabel(opportunity.decision.choice)}</h3>
                    <p>{opportunity.decision.reason}</p>
                  </div>
                  <button type="button" onClick={resetOpportunity}>
                    Проверить другую вакансию
                  </button>
                </section>
              )}

              {workspace.actionPackage ? (
                <section className="career-action-package">
                  <div className="career-section-heading">
                    <div>
                      <p className="career-eyebrow">Готово из подтверждённых фактов</p>
                      <h3>Пакет следующего действия</h3>
                    </div>
                  </div>
                  <strong>{workspace.actionPackage.positioningLine}</strong>
                  <pre>{composeMessage(workspace.actionPackage)}</pre>
                  <ol>
                    {getActionChecklist(
                      workspace.actionPackage.decisionChoice,
                    ).map((item) => (
                      <li key={item.id}>
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                      </li>
                    ))}
                  </ol>
                  <section className="career-outcome-loop">
                    {activeOutcomes.length === 0 ? (
                      <>
                        <p className="career-eyebrow">Результат ещё не записан</p>
                        <h4>Отправка остаётся вашим действием</h4>
                        <p>
                          После отправки в официальном интерфейсе отметьте факт
                          здесь. До этого openqareer не считает действие выполненным.
                        </p>
                        <button
                          className="career-primary-button"
                          type="button"
                          onClick={() =>
                            addOutcome(
                              workspace.actionPackage?.decisionChoice === 'apply'
                                ? 'applied'
                                : 'contacted',
                            )
                          }
                        >
                          Отметить отправку
                          <Check size={17} weight="bold" />
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="career-eyebrow">Следующий шаг по факту</p>
                        <h4>{outcomeNextAction?.title}</h4>
                        <p>{outcomeNextAction?.reason}</p>
                        {outcomeNextAction?.code === 'set-follow-up' ? (
                          <div className="career-follow-up-date">
                            <label>
                              <span>Дата проверки ответа</span>
                              <input
                                type="date"
                                value={followUpDate}
                                min={new Date(Date.now() + 86_400_000)
                                  .toISOString()
                                  .slice(0, 10)}
                                onChange={(event) =>
                                  setFollowUpDate(event.target.value)
                                }
                              />
                            </label>
                            <button
                              type="button"
                              disabled={!followUpDate}
                              onClick={() =>
                                addOutcome(
                                  workspace.actionPackage?.decisionChoice ===
                                    'apply'
                                    ? 'applied'
                                    : 'contacted',
                                  new Date(
                                    `${followUpDate}T12:00:00`,
                                  ).toISOString(),
                                )
                              }
                            >
                              Сохранить дату проверки
                            </button>
                          </div>
                        ) : null}
                        <div className="career-outcome-choices">
                          <button
                            type="button"
                            onClick={() => addOutcome('positive-reply')}
                          >
                            Получен положительный ответ
                          </button>
                          <button
                            type="button"
                            onClick={() => addOutcome('negative-reply')}
                          >
                            Получен отказ
                          </button>
                          <button
                            type="button"
                            onClick={() => addOutcome('interview')}
                          >
                            Назначено интервью
                          </button>
                          <button
                            type="button"
                            onClick={() => addOutcome('offer')}
                          >
                            Получен оффер
                          </button>
                        </div>
                      </>
                    )}
                  </section>
                </section>
              ) : null}
            </div>
          ) : null}
          <p className="career-opportunity-caveat">
            Это сравнение с одной вакансией, не оценка всего рынка и не гарантия
            прохождения отбора.
          </p>
        </section>
      )}

      <section className="career-source-readiness" aria-labelledby="sources-title">
        <div className="career-section-heading">
          <div>
            <p className="career-eyebrow">Источники поиска</p>
            <h2 id="sources-title">Что можно подключить</h2>
          </div>
        </div>
        <div>
          <SourceCapability
            title="PDF, текст, экспорт LinkedIn и hh.ru"
            state="available"
            detail="Работает локально без паролей и cookies."
          />
          <SourceCapability
            title="hh.ru: свежая выборка вакансий"
            state="available"
            detail="Публичный источник с датой наблюдения и ссылками на оригиналы."
          />
          <SourceCapability
            title="LinkedIn и hh.ru, тестовые аккаунты"
            state="prepared"
            detail="Адаптеры проверяются только после завершения интерфейса."
          />
          <SourceCapability
            title="Другие работные сайты и career pages"
            state="prepared"
            detail="Потребуются источники, даты и проверка качества дублей."
          />
        </div>
      </section>

      <section
        className={`career-paid-moment ${
          journey.commercialBoundary.state === 'free-route-incomplete'
            ? 'is-free-route'
            : ''
        }`}
      >
        <div>
          {journey.commercialBoundary.state === 'assisted-setup-eligible' ? (
            <Sparkle size={21} weight="fill" />
          ) : (
            <Compass size={21} />
          )}
          <span>
            <strong>{journey.commercialBoundary.headline}</strong>
            <small>{journey.commercialBoundary.reason}</small>
          </span>
        </div>
        <button
          type="button"
          onClick={() =>
            onNavigate(
              journey.commercialBoundary.state === 'assisted-setup-eligible'
                ? 'tariffs'
                : 'career',
            )
          }
        >
          {journey.commercialBoundary.state === 'assisted-setup-eligible'
            ? 'Посмотреть объём работы'
            : 'Завершить роль и рынок'}
          <ArrowRight size={16} />
        </button>
      </section>
    </div>
  );
}

function opportunityItemLabel(kind: 'task' | 'requirement' | 'condition') {
  if (kind === 'task') return 'Задача';
  if (kind === 'requirement') return 'Требование';
  return 'Условие';
}

function opportunityChoiceLabel(choice: OpportunityChoice) {
  if (choice === 'apply') return 'Откликаться';
  if (choice === 'network') return 'Сначала найти контакт';
  if (choice === 'watch') return 'Наблюдать';
  return 'Пропустить';
}

function explainOpportunityRecommendation(choice: OpportunityChoice) {
  if (choice === 'apply') {
    return 'Ключевые требования имеют опору в подтверждённых фактах, а жёсткого конфликта с условиями не найдено.';
  }
  if (choice === 'network') {
    return 'В профиле есть релевантная опора, но условия и контекст роли подтверждены не полностью. Сначала безопаснее уточнить их у команды.';
  }
  if (choice === 'watch') {
    return 'Подтверждённых оснований для отклика пока недостаточно. Вакансию можно сохранить как наблюдение и сначала усилить профиль.';
  }
  return 'Обнаружен подтверждённый конфликт с важным ограничением кандидата.';
}


function outcomeNote(type: OutcomeType) {
  if (type === 'applied') return 'Отклик отправлен кандидатом.';
  if (type === 'contacted') return 'Контакт отправлен кандидатом.';
  if (type === 'positive-reply') return 'Кандидат отметил положительный ответ.';
  if (type === 'negative-reply') return 'Кандидат отметил отказ.';
  if (type === 'interview') return 'Кандидат отметил назначенное интервью.';
  if (type === 'offer') return 'Кандидат отметил полученный оффер.';
  return 'Кандидат остановил процесс по этой возможности.';
}
