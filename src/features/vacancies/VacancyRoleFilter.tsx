import { Check, LockSimple } from '@phosphor-icons/react';

import type { VacanciesScreenState } from './vacanciesScreenState';
import './vacancy-location-tree.css';

/**
 * Поповер «Роли» по макету 4 (`?frame&pop=roles`, B547 / возврат B447):
 * роли кампании кандидата чекбоксами с числом вакансий подборки, гипотезы,
 * ждущие проверки навыков, — заметкой. Пустой выбор — все роли кампании.
 */

export interface RoleOption {
  readonly role: string;
  readonly count?: number;
}

export interface VacancyRoleFilterProps {
  readonly state: VacanciesScreenState;
  readonly roles: readonly RoleOption[];
  readonly pendingHypotheses: readonly string[];
  readonly onChange: (updater: (prev: VacanciesScreenState) => VacanciesScreenState) => void;
  readonly withFooter: boolean;
  readonly onCancel: () => void;
  readonly onApply: () => void;
}

const numberFormat = new Intl.NumberFormat('ru-RU');

export function isRoleChecked(state: VacanciesScreenState, role: string): boolean {
  return !state.roles.length || state.roles.includes(role);
}

/** Снятие роли при пустом выборе («все») оставляет остальные роли кампании. */
export function toggleRole(
  state: VacanciesScreenState,
  role: string,
  all: readonly string[],
): VacanciesScreenState {
  const current = state.roles.length ? state.roles : all;
  const next = current.includes(role)
    ? current.filter((value) => value !== role)
    : [...current, role];
  return { ...state, roles: next.length === all.length ? [] : next };
}

function pendingNote(names: readonly string[]): string {
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} и ${names.at(-1)}` : (names[0] ?? '');
  return `${list}: после проверки навыков.`;
}

function RoleFooter({
  chosen,
  onCancel,
  onApply,
}: {
  readonly chosen: number;
  readonly onCancel: () => void;
  readonly onApply: () => void;
}) {
  return (
    <div className="vacancy-location-foot">
      <span className="vacancy-location-chosen">Выбрано {numberFormat.format(chosen)}</span>
      <button type="button" className="vac-sm is-ghost" onClick={onCancel}>
        Отмена
      </button>
      <button
        type="button"
        className="vac-sm vacancies-filter-apply"
        disabled={chosen === 0}
        onClick={onApply}
      >
        <Check size={16} weight="bold" aria-hidden="true" />
        Применить
      </button>
    </div>
  );
}

export function VacancyRoleFilter(props: VacancyRoleFilterProps) {
  const all = props.roles.map(({ role }) => role);
  const chosen = all.filter((role) => isRoleChecked(props.state, role)).length;
  return (
    <div className="vacancy-location-filter vacancy-role-filter" data-testid="role-tree-filter">
      <div className="vacancy-location-body">
        {all.length ? (
          <ul className="vacancy-location-tree" aria-label="Роли">
            {props.roles.map(({ role, count }) => (
              <li key={role} className="vacancy-location-node">
                <div className="vacancy-location-row">
                  <span className="vacancy-location-spacer" />
                  <label className="career-checkbox-label vacancy-location-check">
                    <input
                      type="checkbox"
                      className="career-checkbox"
                      checked={isRoleChecked(props.state, role)}
                      onChange={() => props.onChange((prev) => toggleRole(prev, role, all))}
                    />
                    <span className="vacancy-location-name">{role}</span>
                  </label>
                  <span className="vacancy-location-count">
                    {count === undefined ? '' : numberFormat.format(count)}
                  </span>
                </div>
              </li>
            ))}
            {props.pendingHypotheses.length ? (
              <li className="vacancy-location-note">
                <LockSimple size={16} aria-hidden="true" />
                <span>{pendingNote(props.pendingHypotheses)}</span>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="vacancy-location-found">
            Роли кампании ещё не выбраны. Их задаёт раздел «Карьера».
          </p>
        )}
      </div>
      {props.withFooter ? (
        <RoleFooter chosen={chosen} onCancel={props.onCancel} onApply={props.onApply} />
      ) : null}
    </div>
  );
}
