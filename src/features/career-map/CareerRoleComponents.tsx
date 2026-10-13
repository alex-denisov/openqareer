import { useState, type ReactElement } from 'react';
import {
  Briefcase,
  CaretDown,
  ChatCircleText,
  CheckCircle,
  Lightbulb,
  ListChecks,
  Warning,
  X,
} from '@phosphor-icons/react';
import type { CareerRoleModel, RoleStatus } from './careerScreenTypes';

export function RoleStatusBadge({ status }: { status: RoleStatus }): ReactElement {
  if (status === 'open_for_search') {
    return (
      <span className="career-badge career-badge-ok">
        <CheckCircle size={14} />
        Открыта для поиска
      </span>
    );
  }
  if (status === 'skills_checked') {
    return (
      <span className="career-badge career-badge-ok">
        <CheckCircle size={14} />
        Навыки проверены
      </span>
    );
  }
  return (
    <span className="career-badge career-badge-hyp">
      <Lightbulb size={14} />
      Гипотеза
    </span>
  );
}

export function RoleStageStepper({ status }: { status: RoleStatus }): ReactElement {
  const isHypDone = true;
  const isSkillsDone = status === 'skills_checked' || status === 'open_for_search';
  const isSearchDone = status === 'open_for_search';

  return (
    <ol className="career-stepper" aria-label="Статус роли">
      <li className={`career-step ${isHypDone ? 'career-step-done' : ''}`}>
        <CheckCircle size={16} />
        <span>Гипотеза</span>
      </li>
      <li
        className={`career-step ${
          isSkillsDone ? 'career-step-done' : status === 'hypothesis' ? 'career-step-current' : ''
        }`}
      >
        {isSkillsDone ? <CheckCircle size={16} /> : <ListChecks size={16} />}
        <span>Навыки проверены</span>
      </li>
      <li className={`career-step ${isSearchDone ? 'career-step-done' : ''}`}>
        {isSearchDone ? <CheckCircle size={16} /> : <Briefcase size={16} />}
        <span>Открыть для поиска</span>
      </li>
    </ol>
  );
}

export function RoleConfirmedSection({ items }: { items: readonly string[] }): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <div className="career-role-section">
      <h4 className="career-section-subhead">Подтверждено</h4>
      <ul className="career-check-list">
        {items.map((item, index) => (
          <li key={index} className="career-check-item">
            <CheckCircle size={16} color="var(--career-text-success, #059669)" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RoleMissingSection({
  role,
  onNavigateSection,
}: {
  role: CareerRoleModel;
  onNavigateSection?: (section: string) => void;
}): ReactElement | null {
  if (role.missingItems.length === 0) return null;
  return (
    <div className="career-role-section">
      <h4 className="career-section-subhead">Чего не хватает для этой роли</h4>
      <ul className="career-check-list">
        {role.missingItems.map((missing, index) => (
          <li key={index} className="career-check-item">
            {missing.isWarning ? (
              <Warning size={16} color="var(--career-text-warning, #d97706)" />
            ) : (
              <Lightbulb size={16} />
            )}
            <span>{missing.text}</span>
            {missing.linkSection ? (
              <button
                type="button"
                className="career-link-btn"
                onClick={() => onNavigateSection?.(missing.linkSection!)}
              >
                {missing.linkSection}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="career-source-stamp">Сверка с требованиями {role.sampleNote}.</p>
    </div>
  );
}

function RoleRejectAction({
  role,
  onRejectRole,
}: {
  role: CareerRoleModel;
  onRejectRole: (roleId: string) => void;
}): ReactElement {
  const [confirmReject, setConfirmReject] = useState(false);

  if (confirmReject) {
    return (
      <div className="career-role-reject-confirm">
        <button
          type="button"
          className="career-btn career-btn-secondary"
          onClick={() => {
            onRejectRole(role.id);
            setConfirmReject(false);
          }}
        >
          Подтвердить снятие
        </button>
        <button
          type="button"
          className="career-btn career-btn-ghost"
          onClick={() => setConfirmReject(false)}
        >
          Отмена
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="career-btn career-btn-ghost"
      onClick={() => setConfirmReject(true)}
    >
      <X size={16} />
      {role.status === 'open_for_search' ? 'Снять роль' : 'Отклонить роль'}
    </button>
  );
}

export function RoleActionsRow({
  role,
  onConsultant,
  onOpenVacancies,
  onCheckSkills,
  onRejectRole,
}: {
  role: CareerRoleModel;
  onConsultant: (roleId: string) => void;
  onOpenVacancies: (roleTitle: string) => void;
  onCheckSkills: (roleId: string) => void;
  onRejectRole: (roleId: string) => void;
}): ReactElement {
  return (
    <div className="career-role-actions">
      {role.nextAction.action === 'fill_with_consultant' ? (
        <button
          type="button"
          className="career-btn career-btn-primary"
          onClick={() => onConsultant(role.id)}
        >
          <ChatCircleText size={18} />
          Дозаполнить с консультантом
        </button>
      ) : null}
      {role.nextAction.action === 'check_skills' ? (
        <button
          type="button"
          className="career-btn career-btn-primary"
          onClick={() => onCheckSkills(role.id)}
        >
          <ListChecks size={18} />
          Проверить навыки
        </button>
      ) : null}
      <button
        type="button"
        className="career-btn career-btn-secondary"
        onClick={() => onOpenVacancies(role.title)}
      >
        <Briefcase size={18} />
        Открыть вакансии роли
      </button>
      <RoleRejectAction role={role} onRejectRole={onRejectRole} />
    </div>
  );
}

function RoleBenefitSection({ benefit }: { benefit?: string }): ReactElement | null {
  if (!benefit) return null;
  return (
    <div className="career-role-section">
      <h4 className="career-section-subhead">Что даст проверка навыков</h4>
      <p className="career-check-item">
        <ListChecks size={16} />
        <span>{benefit}</span>
      </p>
    </div>
  );
}

export function CareerRoleCard({
  role,
  isOpenDefault,
  onConsultant,
  onOpenVacancies,
  onCheckSkills,
  onRejectRole,
  onNavigateSection,
}: {
  role: CareerRoleModel;
  isOpenDefault?: boolean;
  onConsultant: (roleId: string) => void;
  onOpenVacancies: (roleTitle: string) => void;
  onCheckSkills: (roleId: string) => void;
  onRejectRole: (roleId: string) => void;
  onNavigateSection?: (section: string) => void;
}): ReactElement {
  return (
    <details className="career-role-item" open={isOpenDefault}>
      <summary className="career-role-summary">
        <div className="career-role-summary-left">
          <div className="career-role-title-row">
            <h3 className="career-role-title">{role.title}</h3>
            <RoleStatusBadge status={role.status} />
          </div>
          <p className="career-role-meta">
            {role.wageDisplay} · {role.vacancyCount} вакансий · {role.observedDate}
          </p>
        </div>
        <CaretDown size={20} className="career-role-caret" />
      </summary>
      <div className="career-role-body">
        <RoleStageStepper status={role.status} />
        {role.hypothesisReason ? <p className="career-note">{role.hypothesisReason}</p> : null}
        <RoleConfirmedSection items={role.confirmedItems} />
        <RoleMissingSection role={role} onNavigateSection={onNavigateSection} />
        <RoleBenefitSection benefit={role.skillCheckBenefit} />
        <RoleActionsRow
          role={role}
          onConsultant={onConsultant}
          onOpenVacancies={onOpenVacancies}
          onCheckSkills={onCheckSkills}
          onRejectRole={onRejectRole}
        />
      </div>
    </details>
  );
}
