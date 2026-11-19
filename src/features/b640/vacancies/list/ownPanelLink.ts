import { buildNodePath } from '../../routes';

const OWN_PANEL_PARAM = 'own';

/** Подборка с открытой панелью «Своя вакансия» (макет v06q): «Откликнулся сам — добавить» в «Откликах». */
export function ownPanelPath(): string {
  return `${buildNodePath('s07')}?${OWN_PANEL_PARAM}=1`;
}

export function ownPanelRequested(search: string): boolean {
  return new URLSearchParams(search).get(OWN_PANEL_PARAM) === '1';
}
