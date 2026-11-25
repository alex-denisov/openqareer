import type { StoredResumeVersion } from './resumeVersions';

const targetOf = (version: StoredResumeVersion): string =>
  JSON.stringify([version.title, version.requirements]);

/**
 * B801: правка, язык или новое резюме дают новую версию для той же вакансии, и в «Профиле» вакансия
 * стояла несколько раз. Остаётся последняя одобренная; отправленные и черновики не сводятся.
 * Прежние версии не хранят вакансию: их цель — название и требования, снятые с неё дословно.
 * Список — от новых к старым.
 */
export function latestPerVacancy(
  versions: readonly StoredResumeVersion[],
): readonly StoredResumeVersion[] {
  const seenVacancies = new Set<string>();
  const seenTargets = new Set<string>();
  return versions.filter((version) => {
    if (version.status !== 'approved') return true;
    const target = targetOf(version);
    const repeated = version.vacancyId
      ? seenVacancies.has(version.vacancyId)
      : seenTargets.has(target);
    if (version.vacancyId) seenVacancies.add(version.vacancyId);
    seenTargets.add(target);
    return !repeated;
  });
}
