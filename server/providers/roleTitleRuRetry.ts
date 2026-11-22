import type { NamedRole } from '../../shared/roleProposals';
import type { RoleNameLanguage } from '../domain/roleNameLanguage';
import type { CandidateFact, RoleNamer, RoleNamingOutcome } from './roleNamer';

/** Перевод английских названий должностей одним вызовом: название → проверенный titleRu. */
export interface RoleTitleTranslator {
  translateTitles(titles: readonly string[]): Promise<Readonly<Record<string, string>>>;
}

export interface TitleRuRetryOptions {
  readonly inner: RoleNamer;
  readonly translator: RoleTitleTranslator;
  /** Ложь — русское название уже даёт онтология, второй вызов о нём не нужен. */
  readonly needsTranslation: (title: string) => boolean;
}

const CYRILLIC = /[А-Яа-яЁё]/u;

/**
 * B748: вторая проверенная попытка русского названия.
 *
 * Модель называет роли и даёт titleRu, но проверка отвергает перевод, где
 * потеряна аббревиатура или осталась латиница. Такие названия уходят одной
 * пачкой на перевод; отвергнутое и во второй раз остаётся английским —
 * выдуманного перевода кандидат не видит. Обёртка стоит под хранилищем:
 * перевод сохраняется вместе с ролями и второй раз не спрашивается.
 */
export class TitleRuRetryRoleNamer implements RoleNamer {
  /** Открыт наружу: по нему сборка называет ступени очереди. */
  readonly inner: RoleNamer;
  private readonly translator: RoleTitleTranslator;
  private readonly needsTranslation: (title: string) => boolean;

  constructor(options: TitleRuRetryOptions) {
    this.inner = options.inner;
    this.translator = options.translator;
    this.needsTranslation = options.needsTranslation;
  }

  async nameRoles(
    facts: readonly CandidateFact[],
    language: RoleNameLanguage,
  ): Promise<RoleNamingOutcome> {
    const outcome = await this.inner.nameRoles(facts, language);
    const missing = [
      ...new Set(outcome.roles.filter((role) => this.untranslated(role)).map((role) => role.title)),
    ];
    if (missing.length === 0) return outcome;
    const translated = await this.translate(missing);
    if (Object.keys(translated).length === 0) return outcome;
    return {
      ...outcome,
      roles: outcome.roles.map((role) => withTitleRu(role, translated[role.title])),
    };
  }

  private untranslated(role: NamedRole): boolean {
    return !role.titleRu && !CYRILLIC.test(role.title) && this.needsTranslation(role.title);
  }

  private async translate(titles: readonly string[]): Promise<Readonly<Record<string, string>>> {
    try {
      return await this.translator.translateTitles(titles);
    } catch (error) {
      // Перевод — улучшение, а не условие: роли остаются, причина — в лог.
      console.warn(
        '[role-naming] titleRu retry failed',
        error instanceof Error ? error.message : error,
      );
      return {};
    }
  }
}

function withTitleRu(role: NamedRole, titleRu: string | undefined): NamedRole {
  return titleRu && !role.titleRu ? { ...role, titleRu } : role;
}

/** Ступени перевода по очереди: следующая спрашивается, только когда предыдущая упала. */
export class QueuedTitleTranslator implements RoleTitleTranslator {
  constructor(private readonly stages: readonly RoleTitleTranslator[]) {}

  async translateTitles(titles: readonly string[]): Promise<Readonly<Record<string, string>>> {
    let last: unknown = new Error('no translator stages');
    for (const stage of this.stages) {
      try {
        return await stage.translateTitles(titles);
      } catch (error) {
        last = error;
      }
    }
    throw last;
  }
}
