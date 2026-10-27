import type { ReactElement } from 'react';
import {
  CaretLeft,
  CaretRight,
  Coins,
  Globe,
  HouseLine,
  MapPin,
  Prohibit,
} from '@phosphor-icons/react';
import type {
  CareerPushView,
  CareerRoleModel,
  RolesMarketSummary,
  SearchConditionsDraft,
} from './careerScreenTypes';
import {
  CareerRoleBody,
  NO_VACANCIES_NOTE,
  RoleStatusBadge,
  type RoleHandlers,
} from './CareerRoleComponents';
import {
  conditionRows,
  ConditionsMarketLine,
  type EditableConditionField,
} from './CareerConditionsComponents';
import { formatVacancyCount } from './careerWageFork';

/** Подборка «Вакансий» идёт по ролям «Карьеры» сразу (решение владельца 26.10). */
export const ROLES_SEARCH_NOTE =
  '«Вакансии» подбираются по всем ролям этого списка, включая гипотезы. Отклонённая роль уходит из подборки.';

export function MobileHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}): ReactElement {
  return (
    <div className="career-mobile-header">
      <button
        type="button"
        className="career-btn career-btn-ghost career-back-button"
        aria-label="Назад"
        onClick={onBack}
      >
        <CaretLeft size={20} aria-hidden />
      </button>
      <h2 className="career-mobile-title">{title}</h2>
    </div>
  );
}

function MobileRoleRow({
  role,
  onOpen,
}: {
  role: CareerRoleModel;
  onOpen: () => void;
}): ReactElement {
  return (
    <li>
      <button type="button" className="career-m-row" onClick={onOpen}>
        <span className="career-m-row-main career-m-role-main">
          <span className="career-m-role-head">
            <span className="career-m-row-title">{role.title}</span>
            <CaretRight size={16} aria-hidden />
          </span>
          <span className="career-role-meta">
            {role.vacancyCount === 0
              ? NO_VACANCIES_NOTE
              : `${role.wageDisplay} · ${formatVacancyCount(role.vacancyCount)}`}
          </span>
          <span className="career-m-row-foot">
            <RoleStatusBadge status={role.status} />
            <span
              className={
                role.nextAction.action === 'few_data' ? 'career-m-action-muted' : 'career-m-action'
              }
            >
              {role.nextAction.label}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

function MobileRolesGroup({
  roles,
  onOpenRole,
}: {
  roles: readonly CareerRoleModel[];
  onOpenRole: (roleId: string) => void;
}): ReactElement {
  return (
    <section className="career-m-group" aria-labelledby="m-roles-h">
      <h3 id="m-roles-h" className="career-m-group-title">
        Мои роли на рынке · {roles.length}
      </h3>
      {roles.length === 0 ? (
        <p className="career-m-note">
          Ролей пока нет: консультант назовёт их, когда в профиле будет опыт.
        </p>
      ) : (
        <ul className="career-m-list">
          {roles.map((role) => (
            <MobileRoleRow key={role.id} role={role} onOpen={() => onOpenRole(role.id)} />
          ))}
        </ul>
      )}
      <p className="career-m-note">
        Гипотеза — вывод консультанта, не факт. Вилка только по вакансиям с указанной зарплатой.{' '}
        {ROLES_SEARCH_NOTE}
      </p>
    </section>
  );
}

const CONDITION_ICONS: Readonly<Record<Exclude<EditableConditionField, null>, ReactElement>> = {
  geo: <MapPin size={18} aria-hidden />,
  sal: <Coins size={18} aria-hidden />,
  fmt: <HouseLine size={18} aria-hidden />,
  stop: <Prohibit size={18} aria-hidden />,
};

function MobileRelocationRow({
  enabled,
  onOpen,
}: {
  /** null — согласие ещё не прочитано: статус не показываем. */
  enabled: boolean | null;
  onOpen: () => void;
}): ReactElement {
  return (
    <ul className="career-m-list">
      <li>
        <button type="button" className="career-m-row" onClick={onOpen}>
          <span className="career-m-icon">
            <Globe size={18} aria-hidden />
          </span>
          <span className="career-m-row-main">
            <span className="career-m-row-title">Страны и релокация</span>
            {enabled === null ? null : (
              <span className="career-role-meta">
                {enabled
                  ? 'подборка учитывает выбранные страны'
                  : 'сейчас подборка идёт только по России'}
              </span>
            )}
          </span>
          {enabled === null ? null : (
            <span className="career-m-value">{enabled ? 'Включено' : 'Не включено'}</span>
          )}
          <CaretRight size={16} aria-hidden />
        </button>
      </li>
    </ul>
  );
}

function MobileConditionsGroup({
  conditions,
  summary,
  onEditField,
  onOpenRelocation,
  relocationEnabled = conditions.geography.isRelocationEnabled,
}: {
  conditions: SearchConditionsDraft;
  summary: RolesMarketSummary;
  onEditField: (field: Exclude<EditableConditionField, null>) => void;
  onOpenRelocation: () => void;
  /** Согласие анкеты релокации — то же состояние, что в самом разделе (B445-r1); null — ещё не прочитано. */
  relocationEnabled?: boolean | null;
}): ReactElement {
  return (
    <section className="career-m-group" aria-labelledby="m-cond-h">
      <h3 id="m-cond-h" className="career-m-group-title">
        Условия поиска
      </h3>
      <ul className="career-m-list">
        {conditionRows(conditions).map((row) => (
          <li key={row.field}>
            <button type="button" className="career-m-row" onClick={() => onEditField(row.field)}>
              <span className="career-m-icon">{CONDITION_ICONS[row.field]}</span>
              <span className="career-m-row-title">{row.label}</span>
              <span className={row.value ? 'career-m-value' : 'career-m-value career-cond-empty'}>
                {row.value ?? 'Указать'}
              </span>
              <CaretRight size={16} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <ConditionsMarketLine summary={summary} />
      <MobileRelocationRow enabled={relocationEnabled} onOpen={onOpenRelocation} />
    </section>
  );
}

export function MobileCareerHome({
  roles,
  conditions,
  summary,
  onPush,
  onOpenRelocation,
  relocationEnabled,
}: {
  roles: readonly CareerRoleModel[];
  conditions: SearchConditionsDraft;
  summary: RolesMarketSummary;
  onPush: (view: CareerPushView) => void;
  onOpenRelocation: () => void;
  relocationEnabled?: boolean | null;
}): ReactElement {
  return (
    <div className="career-screen career-screen-mobile" data-testid="career-screen">
      <h1 className="career-visually-hidden">Карьера</h1>
      <MobileRolesGroup roles={roles} onOpenRole={(id) => onPush(`role:${id}`)} />
      <MobileConditionsGroup
        conditions={conditions}
        summary={summary}
        onEditField={(field) => onPush(field)}
        onOpenRelocation={onOpenRelocation}
        relocationEnabled={relocationEnabled}
      />
    </div>
  );
}

export function MobileRolePush({
  role,
  onBack,
  handlers,
}: {
  role: CareerRoleModel;
  onBack: () => void;
  handlers: RoleHandlers;
}): ReactElement {
  return (
    <div className="career-screen career-screen-mobile" data-mv={`role:${role.id}`}>
      <MobileHeader title="Роль" onBack={onBack} />
      <div className="career-m-push">
        <h3 className="career-role-title">{role.title}</h3>
        <RoleStatusBadge status={role.status} />
        <p className="career-role-meta">
          {role.wageDisplay} · {formatVacancyCount(role.vacancyCount)}
          {role.observedDate ? ` · ${role.observedDate}` : ''}
        </p>
        <CareerRoleBody role={role} handlers={handlers} />
      </div>
    </div>
  );
}

export function MobileConditionPush({
  title,
  field,
  onBack,
  children,
}: {
  title: string;
  field: Exclude<EditableConditionField, null>;
  onBack: () => void;
  children: ReactElement | null;
}): ReactElement {
  return (
    <div className="career-screen career-screen-mobile" data-mv={field}>
      <MobileHeader title={title} onBack={onBack} />
      <div className="career-m-push">{children}</div>
    </div>
  );
}
