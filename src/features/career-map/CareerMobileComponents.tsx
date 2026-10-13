import { useState, type ReactElement } from 'react';
import {
  Briefcase,
  CaretLeft,
  ChatCircleText,
  CheckCircle,
  ListChecks,
  X,
} from '@phosphor-icons/react';
import type { CareerRoleModel, SearchConditionsDraft } from './careerScreenTypes';
import { RoleStageStepper } from './CareerRoleComponents';

export function MobileHeader({
  title,
  onBack,
}: {
  title: string;
  onBack?: () => void;
}): ReactElement {
  return (
    <div className="career-mobile-header">
      {onBack ? (
        <button
          type="button"
          className="career-btn career-btn-ghost career-back-button"
          aria-label="Назад"
          onClick={onBack}
        >
          <CaretLeft size={20} />
        </button>
      ) : null}
      <h2 className="career-mobile-title">{title}</h2>
    </div>
  );
}

function MobileRoleConfirmedList({ items }: { items: readonly string[] }): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="career-section-subhead">Подтверждено</h4>
      <ul className="career-check-list">
        {items.map((c, i) => (
          <li key={i} className="career-check-item">
            <CheckCircle size={16} color="var(--career-text-success, #059669)" />
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MobileRoleBottomCta({
  role,
  onConsultant,
  onCheckSkills,
}: {
  role: CareerRoleModel;
  onConsultant: (roleId: string) => void;
  onCheckSkills: (roleId: string) => void;
}): ReactElement | null {
  if (role.nextAction.action === 'fill_with_consultant') {
    return (
      <div className="career-mobile-bottom-action">
        <button
          type="button"
          className="career-btn career-btn-primary career-btn-block"
          onClick={() => onConsultant(role.id)}
        >
          <ChatCircleText size={18} />
          Дозаполнить с консультантом
        </button>
      </div>
    );
  }
  if (role.nextAction.action === 'check_skills') {
    return (
      <div className="career-mobile-bottom-action">
        <button
          type="button"
          className="career-btn career-btn-primary career-btn-block"
          onClick={() => onCheckSkills(role.id)}
        >
          <ListChecks size={18} />
          Проверить навыки
        </button>
      </div>
    );
  }
  return null;
}

export function MobileRoleDetailView({
  role,
  onBack,
  onConsultant,
  onOpenVacancies,
  onCheckSkills,
  onRejectRole,
}: {
  role: CareerRoleModel;
  onBack: () => void;
  onConsultant: (roleId: string) => void;
  onOpenVacancies: (roleTitle: string) => void;
  onCheckSkills: (roleId: string) => void;
  onRejectRole: (roleId: string) => void;
}): ReactElement {
  return (
    <div className="career-screen" data-mv={role.id}>
      <MobileHeader title="Роль" onBack={onBack} />
      <div className="career-card">
        <h3>{role.title}</h3>
        <p className="career-role-meta">
          {role.wageDisplay} · {role.vacancyCount} вакансий · {role.observedDate}
        </p>
        <RoleStageStepper status={role.status} />
        {role.hypothesisReason ? <p className="career-note">{role.hypothesisReason}</p> : null}
        <MobileRoleConfirmedList items={role.confirmedItems} />
        <button
          type="button"
          className="career-btn career-btn-secondary"
          onClick={() => onOpenVacancies(role.title)}
        >
          <Briefcase size={18} />
          Открыть вакансии роли
        </button>
        <button
          type="button"
          className="career-btn career-btn-ghost"
          onClick={() => onRejectRole(role.id)}
        >
          <X size={16} />
          {role.status === 'open_for_search' ? 'Снять роль' : 'Отклонить роль'}
        </button>
      </div>
      <MobileRoleBottomCta role={role} onConsultant={onConsultant} onCheckSkills={onCheckSkills} />
    </div>
  );
}

function MobileSalaryCard({
  val,
  showNoWage,
  onValChange,
  onShowNoWageChange,
}: {
  val: string;
  showNoWage: boolean;
  onValChange: (v: string) => void;
  onShowNoWageChange: (s: boolean) => void;
}): ReactElement {
  return (
    <div className="career-card">
      <label className="career-section-subhead" htmlFor="m-sal-in">
        В месяц, ₽
      </label>
      <input
        id="m-sal-in"
        className="career-inline-input"
        value={val}
        onChange={(e) => onValChange(e.target.value)}
      />
      <label className="career-checkbox-label">
        <input
          type="checkbox"
          checked={showNoWage}
          onChange={(e) => onShowNoWageChange(e.target.checked)}
        />
        <span className="career-checkbox-text-sm">Показывать вакансии без зарплаты</span>
      </label>
      <p className="career-role-meta">
        Для вакансий без зарплаты платформа покажет оценку рынка с пометкой «оценка».
      </p>
    </div>
  );
}

export function MobileConditionSalaryView({
  conditions,
  onBack,
  onSave,
}: {
  conditions: SearchConditionsDraft;
  onBack: () => void;
  onSave: (salary: number, showWithoutSalary: boolean) => void;
}): ReactElement {
  const [val, setVal] = useState(conditions.salaryFrom.amountRubles.toString());
  const [showNoWage, setShowNoWage] = useState(conditions.salaryFrom.showWithoutSalary);

  const handleSave = () => {
    const num = parseInt(val.replace(/\s+/g, ''), 10) || conditions.salaryFrom.amountRubles;
    onSave(num, showNoWage);
    onBack();
  };

  return (
    <div className="career-screen" data-mv="sal">
      <MobileHeader title="Зарплата от" onBack={onBack} />
      <MobileSalaryCard
        val={val}
        showNoWage={showNoWage}
        onValChange={setVal}
        onShowNoWageChange={setShowNoWage}
      />
      <button
        type="button"
        className="career-btn career-btn-primary career-btn-block career-mobile-save-btn"
        onClick={handleSave}
      >
        Сохранить
      </button>
    </div>
  );
}
