import {
  ArrowRight,
  CheckCircle,
  Circle,
  Clock,
  Info,
  Lightbulb,
  Spinner,
  WarningCircle,
} from '@phosphor-icons/react';
import type { RoleSkillAssessmentCurrent } from './roleSkillAssessmentApi';

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(
        date,
      )
    : 'дата не указана';
}

export function getProgressStep(status: string, dialogueIndex: number): number {
  if (status === 'dialogue') return 1;
  if (status === 'suggestions') return 2;
  if (status === 'cases') return 3;
  return status === 'complete' ? 4 : dialogueIndex > 0 ? 1 : 0;
}

export function ProgressTrack({ step }: { step: number }) {
  const steps = ['Диалог', 'Профиль', 'Кейсы', 'Итог'];
  return (
    <ol className="career-role-assessment-progress" aria-label="Этапы проверки">
      {steps.map((label, index) => (
        <li
          className={index + 1 === step ? 'is-current' : index + 1 < step ? 'is-done' : ''}
          key={label}
        >
          {index + 1 < step ? (
            <CheckCircle size={16} aria-hidden="true" />
          ) : (
            <Circle size={16} aria-hidden="true" />
          )}
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export function LoadingState() {
  return (
    <div className="career-role-assessment-state" role="status">
      <Spinner size={24} className="is-spinning" aria-hidden="true" /> Загружаем требования и
      сохранённый прогресс…
    </div>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="career-role-assessment-error" role="alert">
      <WarningCircle size={20} aria-hidden="true" />
      <p>{message}</p>
      <button className="career-quiet-button" type="button" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <section className="career-role-assessment-state">
      <h2>Проверка пока недоступна</h2>
      <p>{message ?? 'Сервис не ответил. Сохранённые данные не изменены.'}</p>
      <button className="career-primary-button" type="button" onClick={onRetry}>
        Обновить
      </button>
    </section>
  );
}

export function NoRoleState({ onOpenOpportunities }: { onOpenOpportunities: () => void }) {
  return (
    <EmptyState
      title="Сначала выберите роль"
      text="Проверка строится по роли, которую вы сохранили в стратегии карьеры."
      action="Открыть роли"
      onAction={onOpenOpportunities}
    />
  );
}

export function SourceErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      title="Не удалось сверить вакансии"
      text="Сервис подбора временно не ответил. Проверка не началась; попробуйте обновить данные позже."
      action="Повторить сверку"
      onAction={onRetry}
    />
  );
}

export function TooFewVacanciesState({
  current,
  onOpenOpportunities,
}: {
  current: Extract<RoleSkillAssessmentCurrent, { state: 'too_few_vacancies' }>;
  onOpenOpportunities: () => void;
}) {
  return (
    <EmptyState
      title="Пока мало вакансий для проверки"
      text={`Для роли «${current.roleTitle}» найдено ${current.sampleSize} свежих активных вакансий из ${current.threshold} необходимых. Кейсы не строятся на неполной выборке.`}
      action="Посмотреть вакансии"
      onAction={onOpenOpportunities}
    />
  );
}

export function InsufficientRequirementsState({
  current,
  onOpenOpportunities,
}: {
  current: Extract<RoleSkillAssessmentCurrent, { state: 'insufficient_requirements' }>;
  onOpenOpportunities: () => void;
}) {
  return (
    <EmptyState
      title="Требований пока недостаточно"
      text={`Есть ${current.requirementCount} повторяющихся требований из ${current.sampleSize} вакансий. Для проверки нужны пять навыков и три кейса.`}
      action="К вакансиям"
      onAction={onOpenOpportunities}
    />
  );
}

export function RoleChangedState({
  roleTitle,
  onOpenOpportunities,
}: {
  roleTitle: string;
  onOpenOpportunities: () => void;
}) {
  return (
    <EmptyState
      title="Роль в стратегии изменилась"
      text={`Сохранённая проверка относится к роли «${roleTitle}». Откройте актуальные требования и начните новую проверку.`}
      action="Открыть роли"
      onAction={onOpenOpportunities}
    />
  );
}

export function EmptyState({
  title,
  text,
  action,
  onAction,
}: {
  title: string;
  text: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <section className="career-role-assessment-state">
      <Info size={24} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="career-primary-button" type="button" onClick={onAction}>
        {action}
      </button>
    </section>
  );
}

export function StartState({
  current,
  consent,
  busy,
  howItWorksOpen,
  onToggleHowItWorks,
  onConsent,
  onStart,
}: {
  current: Extract<RoleSkillAssessmentCurrent, { state: 'ready' }>;
  consent: boolean;
  busy: boolean;
  howItWorksOpen: boolean;
  onToggleHowItWorks: () => void;
  onConsent: (value: boolean) => void;
  onStart: () => void;
}) {
  return (
    <section className="career-role-assessment-card career-role-assessment-intro">
      <StartHeading roleTitle={current.roleTitle} />
      <p className="career-role-assessment-lead">
        Около 20 минут: короткий диалог и три практических кейса. Роль откроется для поиска вакансий
        после подтверждения ключевых навыков.
      </p>
      <HowItWorks open={howItWorksOpen} onToggle={onToggleHowItWorks} />
      <StartNotice />
      <label className="career-role-assessment-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => onConsent(event.currentTarget.checked)}
        />
        <span>Согласен передать ответы модели для проверки по критериям.</span>
      </label>
      <StartAction consent={consent} busy={busy} onStart={onStart} />
    </section>
  );
}

function StartHeading({ roleTitle }: { roleTitle: string }) {
  return (
    <div className="career-role-assessment-card-heading">
      <div>
        <span className="career-role-assessment-tag">
          <Lightbulb size={15} aria-hidden="true" /> Гипотеза
        </span>
        <h2>Проверка навыков: {roleTitle}</h2>
      </div>
      <span className="career-role-assessment-meta">
        <CheckCircle size={15} aria-hidden="true" /> Прогресс сохраняется
      </span>
    </div>
  );
}

function HowItWorks({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <>
      <button
        className="career-role-assessment-section-toggle"
        type="button"
        aria-expanded={open}
        onClick={onToggle}
      >
        Как это устроено
      </button>
      {open ? (
        <ol className="career-role-assessment-howto">
          <li>
            <strong>Диалог, около 5 минут.</strong>
            <span>
              Уточним, чего не хватает в профиле. Факты появятся в нём только после вашего принятия.
            </span>
          </li>
          <li>
            <strong>Три кейса, по 3–5 минут.</strong>
            <span>
              Ситуации основаны на требованиях вакансий роли. Кейс можно пропустить; навык останется
              непроверенным.
            </span>
          </li>
          <li>
            <strong>Итог по каждому навыку.</strong>
            <span>
              Подтверждено, частично или не подтверждено — с цитатой из вашего ответа и критериями.
              Оценку можно оспорить.
            </span>
          </li>
        </ol>
      ) : null}
    </>
  );
}

function StartNotice() {
  return (
    <div className="career-role-assessment-notice">
      <Info size={18} aria-hidden="true" />
      <p>
        Ответы проверяет модель по заранее заданным критериям. Это не экзамен и не сертификат. Не
        добавляйте контакты или другие персональные данные. Ответы хранятся в вашем профиле и
        доступны для удаления.
      </p>
    </div>
  );
}

function StartAction({
  consent,
  busy,
  onStart,
}: {
  consent: boolean;
  busy: boolean;
  onStart: () => void;
}) {
  return (
    <div className="career-role-assessment-actions">
      <button
        className="career-primary-button"
        type="button"
        disabled={!consent || busy}
        onClick={onStart}
      >
        <ArrowRight size={17} aria-hidden="true" /> {busy ? 'Готовим проверку…' : 'Начать проверку'}
      </button>
    </div>
  );
}

export function SkillOverview({
  current,
}: {
  current: Extract<RoleSkillAssessmentCurrent, { state: 'ready' }>;
}) {
  return (
    <section className="career-role-assessment-card career-role-assessment-skill-overview">
      <h2>Что проверяем</h2>
      <ul>
        {current.skills.map((skill) => (
          <li key={skill.skillId}>
            <Circle size={15} aria-hidden="true" />
            <div>
              <strong>{skill.name}</strong>
              <span>
                {skill.isKeySkill ? 'Ключевой навык' : 'По требованиям роли'} · {skill.vacancyCount}{' '}
                вакансий
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p className="career-role-assessment-source">
        <Clock size={14} aria-hidden="true" /> Сверка с требованиями {current.sampleSize} свежих
        вакансий · обновлено {formatDate(current.evidenceObservedAt)}.
      </p>
      <p>
        Навык без кейса останется непроверенным. Роль откроется, когда подтверждены ключевые навыки.
      </p>
    </section>
  );
}
