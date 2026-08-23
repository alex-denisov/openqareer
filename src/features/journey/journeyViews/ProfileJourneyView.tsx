import { useState } from 'react';
import {
  ArrowRight,
  Check,
  Info,
} from '@phosphor-icons/react';
import {
  completeCandidateAnalysis,
  createCandidateAnalysis,
  updateEvidenceItem,
  type EvidenceItem,
} from '../../evidence/evidenceEngine';
import {
  type CareerJourney,
} from '../careerJourneyEngine';

import { JourneyViewProps, ViewHeader } from './_shared';
export function CareerPictureRibbon({
  journey,
  onNavigate,
}: {
  journey: CareerJourney;
  onNavigate: JourneyViewProps['onNavigate'];
}) {
  const items = [
    {
      label: 'Подтверждено',
      value: String(journey.profile.confirmedEvidence),
      detail: 'фактов',
      destination: 'profile' as const,
    },
    {
      label: 'Нужно проверить',
      value: String(journey.profile.proposedEvidence),
      detail: 'утверждений',
      destination: 'profile' as const,
    },
    {
      label: 'Гипотезы ролей',
      value: String(journey.roles.length),
      detail: journey.roles.length ? 'для сравнения' : 'пока нет',
      destination: 'career' as const,
    },
    {
      label: 'Рынок',
      value: journey.markets[0]?.state === 'sample-ready' ? 'Есть выборка' : 'Не проверен',
      detail: journey.markets[0]?.label ?? 'не выбран',
      destination: 'career' as const,
    },
  ];
  return (
    <section className="career-picture-ribbon" aria-label="Карьерная картина">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => onNavigate(item.destination)}
        >
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.detail}</small>
        </button>
      ))}
    </section>
  );
}


export function ProfileJourneyView({
  workspace,
  journey,
  onOpenExpert,
  onUpdateWorkspace,
}: JourneyViewProps) {
  const [newEvidence, setNewEvidence] = useState('');
  const evidence = workspace.analysis?.evidenceItems ?? [];

  function changeEvidence(item: EvidenceItem, status: EvidenceItem['status']) {
    if (!workspace.analysis) return;
    const evidenceItems = workspace.analysis.evidenceItems.map((current) =>
      current.id === item.id ? updateEvidenceItem(current, { status }) : current,
    );
    const analysis = workspace.targetDirection.trim()
      ? completeCandidateAnalysis(
          workspace.targetDirection,
          { ...workspace.analysis, evidenceItems },
          new Date().toISOString(),
        )
      : { ...workspace.analysis, evidenceItems };
    onUpdateWorkspace({
      ...workspace,
      analysis,
      updatedAt: new Date().toISOString(),
    });
  }

  function addEvidence() {
    const clean = newEvidence.trim();
    if (clean.length < 30) return;
    const resumeText = [workspace.resumeText, clean].filter(Boolean).join('\n\n');
    const extracted = createCandidateAnalysis(resumeText);
    const priorByStatement = new Map(
      (workspace.analysis?.evidenceItems ?? []).map((item) => [
        item.statement,
        item,
      ]),
    );
    const evidenceItems = extracted.evidenceItems.map(
      (item) => priorByStatement.get(item.statement) ?? item,
    );
    const analysis = workspace.targetDirection.trim()
      ? completeCandidateAnalysis(
          workspace.targetDirection,
          { ...extracted, evidenceItems },
        )
      : { ...extracted, evidenceItems };
    onUpdateWorkspace({
      ...workspace,
      resumeText,
      resumeSource: 'text',
      analysis,
      updatedAt: new Date().toISOString(),
    });
    setNewEvidence('');
  }

  return (
    <div className="career-view career-profile-view">
      <ViewHeader
        eyebrow="Карьерная картина"
        title="Профиль"
        action="Проверить с экспертом"
        onAction={onOpenExpert}
      />
      <section className="career-profile-overview">
        <div className="career-profile-symbol" aria-hidden="true">
          {workspace.targetDirection.slice(0, 1).toUpperCase() || '?'}
        </div>
        <div>
          <strong>
            {workspace.targetDirection || 'Рабочее направление уточняется'}
          </strong>
          <span>{workspace.currentSituation}</span>
        </div>
        <ProfileState state={journey.profile.state} />
      </section>

      <CareerPictureRibbon journey={journey} onNavigate={() => undefined} />

      <div className="career-two-column-flow">
        <section className="career-evidence-section" aria-labelledby="evidence-title">
          <div className="career-section-heading">
            <div>
              <p className="career-eyebrow">Доказательства</p>
              <h2 id="evidence-title">Что известно об опыте</h2>
            </div>
            <span>{evidence.length} извлечено</span>
          </div>

          {evidence.length ? (
            <div className="career-evidence-list">
              {evidence.map((item) => (
                <article key={item.id} className="career-evidence-row">
                  <div>
                    <EvidenceKind kind={item.kind} />
                    <p>{item.statement}</p>
                    <small>Источник: {journey.profile.sourceLabel}</small>
                  </div>
                  <div className="career-evidence-actions">
                    <button
                      type="button"
                      className={item.status === 'confirmed' ? 'is-confirmed' : ''}
                      onClick={() => changeEvidence(item, 'confirmed')}
                    >
                      <Check size={15} weight="bold" />
                      Верно
                    </button>
                    <button
                      type="button"
                      className={item.status === 'rejected' ? 'is-rejected' : ''}
                      onClick={() => changeEvidence(item, 'rejected')}
                    >
                      Не использовать
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="career-empty-line">
              <Info size={21} />
              <p>
                Пока есть только ваш карьерный вопрос. Добавьте один пример
                работы, чтобы открыть гипотезы ролей.
              </p>
            </div>
          )}

          <div className="career-add-evidence">
            <label>
              <span>Добавить пример задачи или результата</span>
              <textarea
                value={newEvidence}
                onChange={(event) => setNewEvidence(event.target.value)}
                placeholder="Что вы делали, за какой масштаб отвечали и что изменилось?"
                rows={3}
              />
            </label>
            <button
              className="career-quiet-button"
              type="button"
              disabled={newEvidence.trim().length < 30}
              onClick={addEvidence}
            >
              Добавить в профиль
            </button>
          </div>
        </section>

        <aside className="career-open-questions" aria-labelledby="unknowns-title">
          <p className="career-eyebrow">Неизвестно</p>
          <h2 id="unknowns-title">Что сильнее всего изменит картину</h2>
          <ol>
            {journey.profile.importantUnknowns.length ? (
              journey.profile.importantUnknowns.map((question) => (
                <li key={question}>{question}</li>
              ))
            ) : (
              <li>Какие задачи вы хотите выполнять регулярно?</li>
            )}
          </ol>
          <button className="career-text-button" type="button" onClick={onOpenExpert}>
            Ответить в диалоге
            <ArrowRight size={16} />
          </button>
        </aside>
      </div>
    </div>
  );
}


function ProfileState({ state }: { state: CareerJourney['profile']['state'] }) {
  return (
    <span className={`career-profile-state is-${state}`}>
      {state === 'grounded'
        ? 'Есть опорные факты'
        : state === 'needs-review'
          ? 'Нужно подтвердить'
          : 'Формируется'}
    </span>
  );
}

function EvidenceKind({ kind }: { kind: EvidenceItem['kind'] }) {
  const labels: Record<EvidenceItem['kind'], string> = {
    result: 'Результат',
    responsibility: 'Ответственность',
    scope: 'Масштаб',
    expertise: 'Экспертиза',
  };
  return <span className={`career-evidence-kind is-${kind}`}>{labels[kind]}</span>;
}

