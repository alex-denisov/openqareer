import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import { ROLE_NAMING_PROMPT_VERSION } from '../domain/roleNaming';
import type { RoleTitleTranslator } from '../providers/roleTitleRuRetry';
import { roleTitleRu } from '../vacancies/roleTitleRu';
import type { RouteDeps } from './deps';

type Campaign = NonNullable<CandidateWorkspaceState['campaign']>;

export interface RoleTitleRuBackfillDeps {
  readonly candidateStore: Pick<
    RouteDeps['candidateStore'],
    'getCandidateWorkspace' | 'saveCandidateWorkspace'
  >;
  readonly translator: RoleTitleTranslator;
}

const CYRILLIC = /[А-Яа-яЁё]/u;

/**
 * Версия, которой проверены переводы кампании: правка перевода (v7: Operations — эксплуатация,
 * а не инфраструктура; v8: уровень не латиницей) поднимает её, и записанное прошлой версией
 * пересчитывается один раз фоном. Своя, не версия промпта называния: та входит в ключ кэша ролей,
 * и её подъём звал бы модель на первом входе «Карьеры» у каждого кандидата.
 */
export const ROLE_TITLES_RU_VERSION = Math.max(ROLE_NAMING_PROMPT_VERSION, 8);

function allTitles(campaign: Campaign): string[] {
  return [...campaign.roles, ...(campaign.careerRoles ?? []).map((role) => role.title)];
}

const stale = (campaign: Campaign): boolean => campaign.titlesRuVersion !== ROLE_TITLES_RU_VERSION;

/** Пересчёт: все английские названия вне онтологии, уже переведённые тоже. */
function recheckable(campaign: Campaign): string[] {
  return [
    ...new Set(
      allTitles(campaign).filter((title) => !CYRILLIC.test(title) && roleTitleRu(title) === title),
    ),
  ];
}

function toAsk(campaign: Campaign): string[] {
  return stale(campaign) ? recheckable(campaign) : untranslated(campaign);
}

/** Свои проверенные переводы кандидата: роли «Карьеры» и уже переведённые роли поиска. */
function ownTitles(campaign: Campaign): Record<string, string> {
  return {
    ...campaign.roleTitlesRu,
    ...Object.fromEntries(
      (campaign.careerRoles ?? []).flatMap((role) =>
        role.titleRu ? [[role.title, role.titleRu]] : [],
      ),
    ),
  };
}

/** Названия без русского: не кириллица, нет в онтологии и среди своих, ещё не спрашивали. */
function untranslated(campaign: Campaign): string[] {
  const own = ownTitles(campaign);
  const tried = campaign.roleTitlesRu ?? {};
  const titles = allTitles(campaign);
  return [
    ...new Set(
      titles.filter(
        (title) => !CYRILLIC.test(title) && !(title in tried) && roleTitleRu(title, own) === title,
      ),
    ),
  ];
}

function withTranslations(
  campaign: Campaign,
  asked: readonly string[],
  translated: Readonly<Record<string, string>>,
): Campaign {
  const career = new Set((campaign.careerRoles ?? []).map((role) => role.title));
  const wanted = new Set(asked);
  // Новый перевод заменяет записанный; отвергнутый проверкой оставляет прежний.
  const careerRoles = campaign.careerRoles?.map((role) => {
    const titleRu = wanted.has(role.title) ? translated[role.title] : undefined;
    return titleRu && titleRu !== role.titleRu ? { ...role, titleRu } : role;
  });
  // Роль поиска хранит перевод в кампании; отвергнутое помечается английским,
  // чтобы его не спрашивали снова. Роль «Карьеры» хранит перевод у себя.
  const careerRu = new Map((careerRoles ?? []).map((role) => [role.title, role.titleRu]));
  const marks = asked.flatMap((title) =>
    career.has(title) && careerRu.get(title)
      ? []
      : [[title, translated[title] ?? campaign.roleTitlesRu?.[title] ?? title] as const],
  );
  return {
    ...campaign,
    ...(careerRoles ? { careerRoles } : {}),
    roleTitlesRu: { ...campaign.roleTitlesRu, ...Object.fromEntries(marks) },
    titlesRuVersion: ROLE_TITLES_RU_VERSION,
  };
}

/**
 * B748: русские названия ролей поиска, сохранённых до проверенного перевода.
 * Фоновый проход (раз на кандидата за запуск), не чтение экрана: одна пачка на
 * перевод тем же проверенным путём; отвергнутое остаётся английским и
 * помечается, чтобы не спрашивать снова. Подбор не трогается: роли и ревизия
 * те же, перевод в отпечаток процента не входит. Возвращает число записанных названий.
 */
export async function backfillRoleTitlesRu(
  deps: RoleTitleRuBackfillDeps,
  candidateId: string,
): Promise<number> {
  const workspace = deps.candidateStore.getCandidateWorkspace(candidateId);
  const campaign = workspace?.campaign;
  if (!campaign) return 0;
  const asked = toAsk(campaign);
  if (asked.length === 0) {
    // Пересчитывать нечего: версия ставится, чтобы следующий запуск не проверял снова.
    if (stale(campaign)) {
      deps.candidateStore.saveCandidateWorkspace(candidateId, {
        ...workspace,
        campaign: { ...campaign, titlesRuVersion: ROLE_TITLES_RU_VERSION },
      });
    }
    return 0;
  }
  const translated = await deps.translator.translateTitles(asked).catch(() => null);
  if (!translated) return 0;
  // Перевод шёл секунды: пишем поверх свежего чтения, а не того, что было до вызова.
  const fresh = deps.candidateStore.getCandidateWorkspace(candidateId);
  if (!fresh?.campaign) return 0;
  const still = toAsk(fresh.campaign).filter((title) => asked.includes(title));
  if (still.length === 0) return 0;
  deps.candidateStore.saveCandidateWorkspace(candidateId, {
    ...fresh,
    campaign: withTranslations(fresh.campaign, still, translated),
  });
  return still.length;
}
