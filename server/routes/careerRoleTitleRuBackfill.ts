import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
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
  const titles = [...campaign.roles, ...(campaign.careerRoles ?? []).map((role) => role.title)];
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
  const careerRoles = campaign.careerRoles?.map((role) => {
    const titleRu = translated[role.title];
    return titleRu && !role.titleRu ? { ...role, titleRu } : role;
  });
  // Роль поиска хранит перевод в кампании; отвергнутое помечается английским,
  // чтобы его не спрашивали снова. Роль «Карьеры» хранит перевод у себя.
  const marks = asked.flatMap((title) =>
    career.has(title) && translated[title] ? [] : [[title, translated[title] ?? title] as const],
  );
  return {
    ...campaign,
    ...(careerRoles ? { careerRoles } : {}),
    roleTitlesRu: { ...campaign.roleTitlesRu, ...Object.fromEntries(marks) },
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
  const campaign = deps.candidateStore.getCandidateWorkspace(candidateId)?.campaign;
  if (!campaign) return 0;
  const asked = untranslated(campaign);
  if (asked.length === 0) return 0;
  const translated = await deps.translator.translateTitles(asked).catch(() => null);
  if (!translated) return 0;
  // Перевод шёл секунды: пишем поверх свежего чтения, а не того, что было до вызова.
  const workspace = deps.candidateStore.getCandidateWorkspace(candidateId);
  if (!workspace?.campaign) return 0;
  const still = untranslated(workspace.campaign).filter((title) => asked.includes(title));
  if (still.length === 0) return 0;
  deps.candidateStore.saveCandidateWorkspace(candidateId, {
    ...workspace,
    campaign: withTranslations(workspace.campaign, still, translated),
  });
  return still.length;
}
