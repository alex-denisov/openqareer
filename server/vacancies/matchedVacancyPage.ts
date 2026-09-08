import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import type { VacancyCompanyFeatures, VacancyCluster } from '../domain/unifiedVacancy';
import { normalizeCityLabel } from '../../shared/cityLabel';
import { isKnownCountry } from '../domain/geoCoordinates';
import { getCompanyRegistry } from '../domain/companyRegistry';
import { lookupLocationCoordinates } from '../domain/geoCoordinates';
import type { Company } from '../domain/company';

/**
 * Подбор отдаётся страницами, помещающимися в один ответ.
 *
 * Прод отвечал на `/api/v1/candidate/matched-vacancies` одним телом в 794 319
 * байт. Маршрут владельца обрывает соединение примерно на 20 460 байт — на
 * приложении, на статике и одинаково при `gzip` и без него, — поэтому экран
 * «Вакансии» не получал ни одной записи (INC-029). Тот же обрыв заставил
 * релизную сборку резать ассеты на части по 12 288 байт, и подбор берёт ровно
 * этот проверенный размер: страница, которая заведомо доходит.
 *
 * Заодно из ответа уходит то, чего интерфейс не показывает: сводка описания,
 * полный список навыков кластера и все требования — совпавшие и нет. Их было
 * около полутора килобайт на запись, а на экране видно не больше трёх; чтобы
 * покрытие осталось честным, вместо списков едет их счёт.
 */
export const MATCHED_PAGE_BYTE_BUDGET = 12_288;

/** Столько требований печатает карточка вакансии — и совпавших, и нет. */
const VISIBLE_POINTS = 3;

export interface MatchedVacancyPage {
  readonly items: MatchedVacancyItem[];
  readonly total: number;
  readonly offset: number;
  /** Смещение следующей страницы; `null` — пул кончился. */
  readonly nextOffset: number | null;
  /**
   * Смещения всех страниц пула — только на первой странице.
   *
   * Без них следующее смещение известно только из предыдущего ответа, и пул из
   * шестидесяти страниц читается шестьюдесятью кругами по каналу подряд: 73
   * секунды сети на каждый вход и шестьдесят отдельных шансов словить обрыв
   * INC-036 (PRB-023). Названный план едет в `meta`, а не в `data`: байтовый
   * бюджет записей остаётся нетронутым, а до стены канала (~20 460) остаётся
   * восемь килобайт запаса — шестьдесят смещений весят меньше полукилобайта.
   */
  readonly pageOffsets?: readonly number[];
}

function extractLocationCoordinates(
  canonicalLocation?: string,
  company?: Company,
): {
  city?: string;
  country?: string;
  coordinates?: { lat: number; lng: number };
} {
  let city: string | undefined;
  let country: string | undefined;
  let coordinates: { lat: number; lng: number } | undefined;

  if (canonicalLocation) {
    const parts = canonicalLocation.split(',').map((p) => p.trim());
    // «US - San Francisco» и «San Francisco» — один город, а
    // «Germany (Remote) ; Ireland (Remote) ; …» — вовсе не город (B203).
    const named = normalizeCityLabel(parts[0]);
    // «Alma · Italy»: площадка положила в место страну. Страна — не городской
    // хаб, и выдавать её за точку на карте нельзя (B203).
    city = named && isKnownCountry(named) ? undefined : named;
    country = parts[1] || (named && isKnownCountry(named) ? named : undefined);
    coordinates = lookupLocationCoordinates(city, country);
  }

  if (!coordinates && company && company.locations.length > 0) {
    const locWithCoords = company.locations.find((l) => l.coordinates);
    if (locWithCoords) {
      coordinates = locWithCoords.coordinates;
      if (!city) city = normalizeCityLabel(locWithCoords.city);
      if (!country) country = locWithCoords.country;
    } else {
      if (!city) city = normalizeCityLabel(company.locations[0].city);
      if (!country) country = company.locations[0].country;
    }
  }

  return { city, country, coordinates };
}

function resolveCompanyFeatures(cluster: VacancyCluster): VacancyCompanyFeatures | undefined {
  const registry = getCompanyRegistry();
  const company =
    registry.findByName(cluster.canonicalCompany) ??
    (cluster.primaryUrl ? registry.findByDomain(cluster.primaryUrl) : undefined);

  const loc = extractLocationCoordinates(cluster.canonicalLocation, company);

  // Страна без города — тоже сведение о месте: карточка честно скажет страну,
  // хотя точки на карте у неё не будет (B203).
  if (!company && !loc.coordinates && !loc.city && !loc.country) {
    return undefined;
  }

  const hasAttr = (k: string) =>
    Boolean(company?.attributes.some((a) => a.key === k && Boolean(a.value)));

  return {
    relocation: hasAttr('relocation') || undefined,
    currencyRemote: hasAttr('currency_remote') || undefined,
    russianAbroad: hasAttr('russian_founded_abroad') || undefined,
    fullRemote: hasAttr('full_remote') || (cluster.isRemote ? true : undefined),
    industry: company?.industry,
    atsProvider: company?.atsProvider,
    atsBoardUrl: company?.careersUrl,
    city: loc.city,
    country: loc.country,
    coordinates: loc.coordinates,
  };
}

function trim(item: MatchedVacancyItem): MatchedVacancyItem {
  const companyFeatures = item.cluster.companyFeatures ?? resolveCompanyFeatures(item.cluster);
  return {
    cluster: {
      ...item.cluster,
      descriptionSummary: '',
      skills: [],
      ...(companyFeatures ? { companyFeatures } : {}),
    },
    explanation: {
      ...item.explanation,
      matchingPoints: item.explanation.matchingPoints.slice(0, VISIBLE_POINTS),
      missingPoints: item.explanation.missingPoints.slice(0, VISIBLE_POINTS),
      matchingCount: item.explanation.matchingPoints.length,
      missingCount: item.explanation.missingPoints.length,
    },
  };
}

function takePage(
  all: readonly MatchedVacancyItem[],
  start: number,
  budgetBytes: number,
): MatchedVacancyItem[] {
  const items: MatchedVacancyItem[] = [];
  // Открывающая и закрывающая скобки массива входят в тот же бюджет.
  let size = 2;

  for (let index = start; index < all.length; index += 1) {
    const trimmed = trim(all[index]);
    const cost = Buffer.byteLength(JSON.stringify(trimmed), 'utf8') + (items.length > 0 ? 1 : 0);
    // Запись, которая одна не влезает в бюджет, всё равно уходит первой: иначе
    // страница вернулась бы пустой и пул выглядел бы кончившимся.
    if (items.length > 0 && size + cost > budgetBytes) break;
    items.push(trimmed);
    size += cost;
  }

  return items;
}

/**
 * Смещения всех страниц пула — тем же разбиением, каким режется страница.
 *
 * План и факт считает одна функция намеренно: разойдись они хоть на запись,
 * клиент попросил бы смещение, с которого начинается не та страница, и пул
 * приехал бы с дырой или с повтором.
 */
export function planMatchedVacancyPages(
  all: readonly MatchedVacancyItem[],
  budgetBytes: number = MATCHED_PAGE_BYTE_BUDGET,
): number[] {
  const offsets: number[] = [0];
  let start = 0;

  while (start < all.length) {
    const taken = takePage(all, start, budgetBytes).length;
    // Пустая страница на непустом остатке — это бесконечный цикл, а не конец
    // пула. Такой страницы быть не может (одна запись уходит через бюджет),
    // но план обязан кончаться при любом ответе разбиения.
    if (taken === 0) break;
    start += taken;
    if (start < all.length) offsets.push(start);
  }

  return offsets;
}

export function buildMatchedVacancyPage(
  all: readonly MatchedVacancyItem[],
  offset: number,
  budgetBytes: number = MATCHED_PAGE_BYTE_BUDGET,
): MatchedVacancyPage {
  const start = Math.max(0, Math.trunc(offset));
  const items = takePage(all, start, budgetBytes);
  const nextOffset = start + items.length;

  return {
    items,
    total: all.length,
    offset: start,
    nextOffset: nextOffset < all.length ? nextOffset : null,
    // План едет только с первой страницей: в каждом ответе он был бы лишними
    // байтами внутри того самого бюджета, ради которого пул и режется.
    ...(start === 0 ? { pageOffsets: planMatchedVacancyPages(all, budgetBytes) } : {}),
  };
}
