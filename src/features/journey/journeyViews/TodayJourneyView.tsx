import {
  ArrowRight,
  FileText,
  Sparkle,
} from '@phosphor-icons/react';
import type {
  CareerGoal,
} from '../../workspace/workspaceStorage';
import {
  type CareerJourney,
} from '../careerJourneyEngine';

export function TodayJourneyView({
  workspace,
  journey,
  onNavigate,
  onOpenExpert,
}: JourneyViewProps) {
  const activeTrack = journey.track.find((item) => item.status === 'active');
  const hasCareerEvidence =
    journey.profile.confirmedEvidence > 0 ||
    journey.profile.proposedEvidence > 0 ||
    journey.roles.length > 0;
  return (
    <div className="career-view career-today-view">
      <section className="career-next-decision" aria-labelledby="today-title">
        <div className="career-decision-copy">
          <p className="career-eyebrow">Следующее решение</p>
          <h1 id="today-title">{journey.nextAction.headline}</h1>
          <p className="career-lead">{journey.nextAction.reason}</p>
          <div className="career-primary-actions">
            <button
              className="career-primary-button"
              type="button"
              onClick={() => onNavigate(journey.nextAction.destination)}
            >
              {journey.nextAction.label}
              <ArrowRight size={18} weight="bold" />
            </button>
            <button
              className="career-quiet-button"
              type="button"
              onClick={onOpenExpert}
            >
              <Sparkle size={18} weight="fill" />
              Обсудить с экспертом
            </button>
          </div>
          <details className="career-action-explanation">
            <summary>Что изменится после этого</summary>
            <p>{journey.nextAction.expectedChange}</p>
          </details>
        </div>
        <div className="career-now-marker" aria-label="Текущий карьерный результат">
          <span>Сейчас</span>
          <strong>{activeTrack?.label ?? 'Карьерная картина'}</strong>
          <p>{activeTrack?.reason}</p>
        </div>
      </section>

      {hasCareerEvidence ? (
        <CareerPictureRibbon journey={journey} onNavigate={onNavigate} />
      ) : null}

      <CareerDiagnosticSummary
        journey={journey}
        hasCareerEvidence={hasCareerEvidence}
        careerGoal={workspace.careerGoal}
      />

      <section className="career-resume-note" aria-label="Состояние рабочего контекста">
        <FileText size={21} />
        <div>
          <strong>{journey.profile.sourceLabel}</strong>
          <span>
            {workspace.updatedAt === workspace.createdAt
              ? 'Карьерная картина только создана'
              : 'Последние изменения сохранены локально'}
          </span>
        </div>
        <button type="button" onClick={() => onNavigate('profile')}>
          Открыть профиль
          <ArrowRight size={16} />
        </button>
      </section>
    </div>
  );
}

function CareerDiagnosticSummary({
  journey,
  hasCareerEvidence,
  careerGoal,
}: {
  journey: CareerJourney;
  hasCareerEvidence: boolean;
  careerGoal?: CareerGoal;
}) {
  const priorityFindings = journey.diagnostic.findings
    .filter((finding) => finding.severity === 'high')
    .slice(0, 3);
  return (
    <section
      className="career-diagnostic-summary"
      aria-labelledby="career-diagnostic-title"
    >
      <div className="career-diagnostic-intro">
        <p className="career-eyebrow">Предварительная диагностика</p>
        {careerGoal ? (
          <p className="career-diagnostic-goal">
            Цель: {careerGoalLabel(careerGoal)}
          </p>
        ) : null}
        <h2 id="career-diagnostic-title">Что можно сказать уже сейчас</h2>
        <p>
          {hasCareerEvidence
            ? journey.diagnostic.summary
            : 'Не вывод: пока нет доказательств опыта. Ниже показаны границы анализа, которые нужно закрыть до выбора роли и рынка.'}
        </p>
      </div>
      <ol className="career-diagnostic-findings">
        {priorityFindings.map((finding) => (
          <li key={finding.id}>
            <span>
              {finding.certainty === 'fact' ? 'Проблема' : 'Неизвестно'}
            </span>
            <strong>{finding.title}</strong>
            <p>{finding.correction}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function careerGoalLabel(goal: CareerGoal): string {
  const labels: Record<CareerGoal, string> = {
    'find-job': 'найти работу',
    'choose-role': 'выбрать подходящую роль',
    positioning: 'проверить резюме и позиционирование',
    market: 'понять рынки и релокацию',
  };
  return labels[goal];
}
import type { JourneyViewProps } from './_shared';
import { CareerPictureRibbon } from './ProfileJourneyView';
