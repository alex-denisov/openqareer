import { atsBoardContract, atsBoardSourceId, type AtsProvider } from './atsBoardAdapters';
import { MEASURED_ATS_BOARDS } from './atsBoardMeasurements';
import type { RegisteredVacancySource, VacancySourceMeasurement } from './defaultVacancySources';

/**
 * B202 — доска работодателя, найденная живой пробой, становится источником.
 *
 * Запись здесь появляется только после того, как адрес ответил вакансиями с
 * маршрута продукта: реестр из догадок — ровно то, что наполнило продукт
 * площадками, которые не могли вернуть ничего (B161, B199).
 */
export interface MeasuredAtsBoard {
  readonly company: string;
  readonly provider: AtsProvider;
  /** Слаг доски у провайдера — то, что подставляется в адрес. */
  readonly board: string;
  /** Сколько вакансий отдал замер. Ноль сюда не попадает. */
  readonly jobs: number;
  readonly observedAt: string;
  /** Из какого списка владельца пришла компания (провенанс B199/B201). */
  readonly lists: readonly string[];
}

/**
 * Доски работодателей меняются медленнее агрегаторов: вакансия висит неделями,
 * а лента отдаёт весь список целиком. Дважды в сутки — это и свежо, и вежливо.
 */
const ATS_REFRESH_INTERVAL_MINUTES = 720;

export function atsBoardSource(measured: MeasuredAtsBoard): RegisteredVacancySource {
  const contract = atsBoardContract(measured.provider);
  const forbidden = contract.crawlPermission === 'robots_forbidden';
  // SmartRecruiters publishes a documented public Job Postings API, but its
  // robots.txt blocks generic agents. The owner explicitly authorized this
  // product to read that API, so the exception must travel with each source
  // into MultiSourceVacancyEngine rather than living only in the provider
  // contract (B202/B217).
  const robotsOverride =
    measured.provider === 'smartrecruiters'
      ? {
          grantedBy: 'owner' as const,
          grantedOn: '2026-09-19',
          basis:
            'Владелец разрешил читать публичный SmartRecruiters Job Postings API для вакансий работодателей; API возвращает только публичный каталог и сохраняет ссылку на источник.',
        }
      : undefined;
  return {
    id: atsBoardSourceId(measured.provider, measured.board),
    // Имя источника — имя работодателя. Lever и Ashby не публикуют компанию в
    // записи, и разбор берёт её отсюда, а не выдумывает (B202).
    name: measured.company,
    type: 'json_api',
    accessClass: 'api',
    market: `Своя доска работодателя (${contract.name})`,
    addressStatus: forbidden ? 'robots_forbidden' : 'live',
    enabled: !forbidden,
    ...(forbidden
      ? {
          disabledReason: `${contract.name} запретил обход словами: ${contract.robotsNote}. Адаптер написан и ждёт права, а не догадки.`,
        }
      : {}),
    targetUrl: contract.endpoint(measured.board),
    refreshIntervalMinutes: ATS_REFRESH_INTERVAL_MINUTES,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
    ...(robotsOverride ? { robotsOverride } : {}),
  };
}

export const ATS_BOARD_SOURCES: readonly RegisteredVacancySource[] =
  MEASURED_ATS_BOARDS.map(atsBoardSource);

/**
 * Замер доски в той же форме, в какой его читает реестр: включённый источник
 * без наблюдения с маршрута продукта запрещён (B199).
 */
export const ATS_BOARD_MEASUREMENTS: Readonly<Record<string, readonly VacancySourceMeasurement[]>> =
  Object.fromEntries(
    MEASURED_ATS_BOARDS.map((measured) => [
      atsBoardSourceId(measured.provider, measured.board),
      [
        {
          items: measured.jobs,
          observedAt: measured.observedAt,
          route: 'eu-prod' as const,
          note: `доска ${measured.board} у ${atsBoardContract(measured.provider).name}`,
        },
      ],
    ]),
  );
