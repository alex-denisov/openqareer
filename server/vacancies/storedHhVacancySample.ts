import type { HhVacancySample } from '../connectors/hhVacancySearch';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import type { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';

const DEFAULT_PER_PAGE = 12;
const HH_VACANCY_URL = /^https:\/\/(?:[a-z0-9-]+\.)?hh\.ru\/vacancy\/(\d{1,20})\/?$/u;

type SampleItem = HhVacancySample['items'][number];

function sampleItem(vacancy: UnifiedVacancy): SampleItem | null {
  const id = HH_VACANCY_URL.exec(vacancy.url)?.[1];
  if (!id) return null;
  return {
    id,
    title: vacancy.title,
    // Работодатель-частное лицо по имени дальше не идёт (INC-023).
    company:
      vacancy.employerIsPerson || !vacancy.company.trim() ? 'Компания не указана' : vacancy.company,
    location: vacancy.location?.trim() || 'Место не указано',
    sourceUrl: vacancy.url,
    publishedAt: vacancy.publishedAt,
    salary: null,
    workMode: vacancy.isRemote ? 'remote' : 'unknown',
    requirements: [],
  };
}

/**
 * Срез из собственного обхода hh в форме живого поиска. Время среза — последнее
 * наблюдение записей, а не «сейчас»: консультант не выдаёт сохранённое за свежее.
 */
export function toStoredHhSample(
  query: string,
  vacancies: readonly UnifiedVacancy[],
  now: () => string = () => new Date().toISOString(),
): HhVacancySample {
  const items = vacancies.flatMap((vacancy) => sampleItem(vacancy) ?? []);
  const observedAt = vacancies.reduce<string | null>(
    (latest, vacancy) =>
      latest === null || vacancy.provenance.observedAt > latest
        ? vacancy.provenance.observedAt
        : latest,
    null,
  );
  return { source: 'hh', query, found: items.length, fetchedAt: observedAt ?? now(), items };
}

export async function storedHhVacancySample(
  engine: Pick<MultiSourceVacancyEngine, 'storedHhSample'>,
  input: { text: string; perPage?: number },
): Promise<HhVacancySample> {
  const vacancies = await engine.storedHhSample(input.text, input.perPage ?? DEFAULT_PER_PAGE);
  return toStoredHhSample(input.text, vacancies);
}
