import type { NamedRole } from '../../shared/roleProposals';
import type { RoleNameLanguage } from '../domain/roleNameLanguage';
import type { CampaignRoleProposal } from './campaignRoleSet';
import { careerRoleFunctions, careerRoleRowKey } from './careerRoleKey';

export type PositionRole = Pick<
  CampaignRoleProposal,
  'title' | 'titleRu' | 'level' | 'functions' | 'evidenceRefs' | 'reason'
>;

const LEADERSHIP_LEVELS: ReadonlySet<string> = new Set(['head', 'vp', 'c-level']);

/**
 * Роли по должностям (`autoRoles`) до 04.11 на «Карьеру» не попадали: её список называет отдельная
 * модель, и CTO с CIO не видел тот, кого на эти позиции собеседуют. Добавляются только руководящие
 * роли с доказательством и только в функциях, по которым кандидат уже ищет: подбор не расширяется.
 */
export function withPositionRoles(input: {
  readonly named: readonly NamedRole[];
  readonly positionRoles: readonly PositionRole[];
  readonly chosenTitles: readonly string[];
  readonly language: RoleNameLanguage;
}): NamedRole[] {
  const namedTitles = input.named.map((role) => role.title);
  const functions = new Set([...input.chosenTitles, ...namedTitles].flatMap(careerRoleFunctions));
  // Только с названными: в `chosenTitles` лежат и сохранённые роли «Карьеры», среди них прошлый
  // вывод этой функции. Сверка с ними убирала роль через чтение, и список мигал 13 ↔ 11 (04.11).
  // Роли, выбранные самим кандидатом, снимает `careerRolesWithCandidateChoices`.
  const rows = new Set(namedTitles.map(careerRoleRowKey));
  const added = input.positionRoles.flatMap<NamedRole>((role) => {
    const title = input.language === 'ru' ? role.titleRu : role.title;
    const row = careerRoleRowKey(title);
    if (
      !LEADERSHIP_LEVELS.has(role.level ?? '') ||
      role.evidenceRefs.length === 0 ||
      !role.functions.some((code) => functions.has(code)) ||
      rows.has(row)
    ) {
      return [];
    }
    rows.add(row);
    return [{ title, reason: role.reason, evidenceRefs: [...role.evidenceRefs] }];
  });
  return [...input.named, ...added];
}
