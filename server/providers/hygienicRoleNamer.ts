import { sanitizeHiddenMarkersDeep } from '../../shared/textHygiene';
import type { CandidateFact, RoleNamer, RoleNamingOutcome } from './roleNamer';
import type { RoleNameLanguage } from '../domain/roleNameLanguage';

/**
 * Названия ролей доходят до кандидата без невидимых меток (B210).
 *
 * Название роли — не проходящий текст: оно печатается на «Главной», едет в
 * подбор вакансий и переживает рестарт в хранилище названий (B191). Метка
 * внутри слова делает две одинаковые роли разными строками, и совпадение,
 * очевидное глазом, перестаёт быть совпадением для кода.
 *
 * Ступень и причины молчания не трогаются: по ним разбирают инциденты
 * (INC-035).
 */
export class HygienicRoleNamer implements RoleNamer {
  /** Открыт наружу: по нему сборка называет ступени очереди. */
  readonly inner: RoleNamer;

  constructor(options: { inner: RoleNamer }) {
    this.inner = options.inner;
  }

  async nameRoles(
    facts: readonly CandidateFact[],
    language: RoleNameLanguage,
  ): Promise<RoleNamingOutcome> {
    const outcome = await this.inner.nameRoles(facts, language);
    const roles = sanitizeHiddenMarkersDeep(outcome.roles);
    return roles === outcome.roles ? outcome : { ...outcome, roles };
  }
}
