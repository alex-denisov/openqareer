import { useState, type ReactElement } from 'react';
import {
  ArrowRight,
  Briefcase,
  CaretDown,
  ChatCircleText,
  CheckCircle,
  Circle,
  Lightbulb,
  ListChecks,
  Question,
  Warning,
  X,
} from '@phosphor-icons/react';
import type { CareerRoleModel, ConfirmedRoleItem, RoleStatus } from './careerScreenTypes';
import { formatVacancyCount } from './careerWageFork';

export interface RoleHandlers {
  readonly onConsultant: (role: CareerRoleModel) => void;
  readonly onOpenVacancies: (role: CareerRoleModel) => void;
  readonly onCheckSkills: (role: CareerRoleModel) => void;
  readonly onRejectRole: (roleId: string) => Promise<void> | void;
  readonly onNavigateSection: (section: string) => void;
}

const STATUS_LABELS: Readonly<Record<RoleStatus, string>> = {
  hypothesis: 'Гипотеза',
  skills_checked: 'Навыки проверены',
  // CPO 26.10: ступени «Открыта для поиска» нет — подборка идёт по всем ролям.
  open_for_search: 'Навыки проверены',
};

export function RoleStatusBadge({ status }: { status: RoleStatus }): ReactElement {
  const ok = status !== 'hypothesis';
  return (
    <span className={`career-badge ${ok ? 'career-badge-ok' : 'career-badge-hyp'}`}>
      {ok ? <CheckCircle size={14} aria-hidden /> : <Lightbulb size={14} aria-hidden />}
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Причина гипотезы склеивается с «. Это вывод…»: своя конечная точка дала бы «..». */
export function withoutTrailingPeriod(text: string): string {
  return text.trim().replace(/[.…]+$/u, '');
}

/** «вилка · N вакансий · дата» — числа только с выборкой и датой. */
export function roleMetaLine(role: CareerRoleModel): string {
  const parts = [role.wageDisplay, formatVacancyCount(role.vacancyCount)];
  if (role.wageSampleNote) {
    parts.push(
      role.observedDate ? `${role.wageSampleNote}, ${role.observedDate}` : role.wageSampleNote,
    );
  } else if (role.observedDate) {
    parts.push(role.observedDate);
  }
  return parts.join(' · ');
}

type StepState = 'done' | 'current' | 'future';

/** Шкала статуса по кадрам макета: текущий шаг выделен, пройденные отмечены. */
const STEP_ROWS: Readonly<Record<RoleStatus, readonly (readonly [string, StepState])[]>> = {
  hypothesis: [
    ['Гипотеза', 'done'],
    ['Проверка навыков', 'current'],
  ],
  skills_checked: [
    ['Гипотеза', 'done'],
    ['Навыки проверены', 'current'],
  ],
  open_for_search: [
    ['Гипотеза', 'done'],
    ['Навыки проверены', 'current'],
  ],
};

export function RoleStageStepper({ status }: { status: RoleStatus }): ReactElement {
  return (
    <ol className="career-stepper" aria-label="Статус роли">
      {STEP_ROWS[status].map(([label, state]) => (
        <li
          key={label}
          className={`career-step career-step-${state}`}
          aria-current={state === 'current' ? 'step' : undefined}
        >
          {state === 'done' ? (
            <CheckCircle size={16} aria-hidden />
          ) : state === 'current' ? (
            <ArrowRight size={16} aria-hidden />
          ) : (
            <Circle size={16} aria-hidden />
          )}
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}

const CONFIRMED_BY: Readonly<Record<ConfirmedRoleItem['source'], string>> = {
  profile: 'есть в навыках профиля',
  check: 'подтверждено проверкой навыков',
};

function RoleConfirmedSection({ items }: { items: readonly ConfirmedRoleItem[] }): ReactElement {
  return (
    <div className="career-role-section">
      <h4 className="career-section-subhead">Подтверждено</h4>
      {items.length === 0 ? (
        <p className="career-role-meta">
          Пока ничего: совпадений с требованиями вакансий роли нет.
        </p>
      ) : (
        <ul className="career-check-list">
          {items.map((item) => (
            <li key={item.text} className="career-check-item career-check-ok">
              <CheckCircle size={16} aria-hidden />
              <span>
                {item.text}: {CONFIRMED_BY[item.source]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RoleMissingSection({
  role,
  onNavigateSection,
}: {
  role: CareerRoleModel;
  onNavigateSection: (section: string) => void;
}): ReactElement | null {
  if (role.missingItems.length === 0) return null;
  const isHypothesis = role.status === 'hypothesis';
  return (
    <div className="career-role-section">
      <h4 className="career-section-subhead">
        {isHypothesis ? 'Пока неизвестно' : 'Чего не хватает для этой роли'}
      </h4>
      <ul className="career-check-list">
        {role.missingItems.map((missing) => (
          <li key={missing.text} className="career-check-item career-check-row">
            {isHypothesis ? (
              <Question size={16} aria-hidden />
            ) : missing.isWarning ? (
              <Warning size={16} className="career-icon-warning" aria-hidden />
            ) : (
              <Circle size={16} aria-hidden />
            )}
            <span>{missing.text}: в профиле не указано</span>
            {missing.linkSection ? (
              <button
                type="button"
                className="career-link-btn"
                onClick={() => onNavigateSection(missing.linkSection!)}
              >
                {missing.linkSection}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoleRejectAction({
  role,
  onRejectRole,
}: {
  role: CareerRoleModel;
  onRejectRole: RoleHandlers['onRejectRole'];
}): ReactElement {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <span className="career-role-reject-confirm">
        <button
          type="button"
          className="career-btn career-btn-secondary"
          onClick={() => {
            setConfirming(false);
            void onRejectRole(role.id);
          }}
        >
          Да, отклонить
        </button>
        <button
          type="button"
          className="career-btn career-btn-text"
          onClick={() => setConfirming(false)}
        >
          Отмена
        </button>
      </span>
    );
  }
  return (
    <button type="button" className="career-btn is-sm is-ghost" onClick={() => setConfirming(true)}>
      <X size={16} aria-hidden />
      Отклонить роль
    </button>
  );
}

function RoleButton({
  primary,
  icon,
  label,
  onClick,
}: {
  primary: boolean;
  icon: ReactElement;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={`career-btn ${primary ? 'career-btn-primary' : 'career-btn-secondary'}`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

/** Кнопки по статусу роли — состав из макета 3; акцент один. */
export function RoleActionsRow({
  role,
  handlers,
}: {
  role: CareerRoleModel;
  handlers: RoleHandlers;
}): ReactElement {
  const consultant = (primary: boolean) => (
    <RoleButton
      primary={primary}
      icon={<ChatCircleText size={18} aria-hidden />}
      label={
        role.status === 'hypothesis' ? 'Обсудить с консультантом' : 'Дозаполнить с консультантом'
      }
      onClick={() => handlers.onConsultant(role)}
    />
  );
  const vacancies = (primary: boolean) => (
    <RoleButton
      primary={primary}
      icon={<Briefcase size={18} aria-hidden />}
      label="Открыть вакансии роли"
      onClick={() => handlers.onOpenVacancies(role)}
    />
  );
  const checkSkills = (
    <RoleButton
      primary
      icon={<ListChecks size={18} aria-hidden />}
      label="Проверить навыки"
      onClick={() => handlers.onCheckSkills(role)}
    />
  );
  return (
    <div className="career-role-actions">
      {role.status === 'hypothesis' ? [checkSkills, consultant(false)] : null}
      {role.status === 'skills_checked' ? [consultant(true), vacancies(false)] : null}
      {role.status === 'open_for_search' ? vacancies(true) : null}
      <RoleRejectAction role={role} onRejectRole={handlers.onRejectRole} />
    </div>
  );
}

export function CareerRoleBody({
  role,
  handlers,
}: {
  role: CareerRoleModel;
  handlers: RoleHandlers;
}): ReactElement {
  return (
    <div className="career-role-body">
      <RoleStageStepper status={role.status} />
      {role.status === 'hypothesis' && role.hypothesisReason ? (
        <p className="career-note">
          <Lightbulb size={16} aria-hidden />
          <span>
            Гипотеза консультанта: {withoutTrailingPeriod(role.hypothesisReason)}. Это вывод из
            профиля, пока не проверенный.
          </span>
        </p>
      ) : null}
      <RoleConfirmedSection items={role.confirmedItems} />
      <RoleMissingSection role={role} onNavigateSection={handlers.onNavigateSection} />
      {role.skillCheckBenefit ? (
        <div className="career-role-section">
          <h4 className="career-section-subhead">Что даст проверка навыков</h4>
          <p className="career-check-item">
            <ListChecks size={16} aria-hidden />
            <span>{role.skillCheckBenefit}</span>
          </p>
        </div>
      ) : null}
      <p className="career-source-stamp">{role.requirementsNote}</p>
      <RoleActionsRow role={role} handlers={handlers} />
    </div>
  );
}

export function CareerRoleCard({
  role,
  isOpenDefault,
  handlers,
}: {
  role: CareerRoleModel;
  isOpenDefault?: boolean;
  handlers: RoleHandlers;
}): ReactElement {
  return (
    <details className="career-role-item" open={isOpenDefault} data-role-id={role.id}>
      <summary className="career-role-summary">
        <span className="career-role-summary-left">
          <span className="career-role-title-row">
            <h3 className="career-role-title">{role.title}</h3>
            <RoleStatusBadge status={role.status} />
          </span>
          <span className="career-role-meta">{roleMetaLine(role)}</span>
        </span>
        <CaretDown size={20} className="career-role-caret" aria-hidden />
      </summary>
      <CareerRoleBody role={role} handlers={handlers} />
    </details>
  );
}
