import type { VacancyRequirementCoverage, VacancyRoleMatch } from '../../shared/vacancyMatchOrder';

export type VacancySourceType =
  | 'hh'
  | 'remotive'
  | 'telegram'
  | 'rss'
  // A JSON endpoint the board publishes for machines. Each such source has its
  // own record shape, so the adapter is chosen by source id (B164).
  | 'json_api'
  // Страница поиска hh.ru: площадка отдаёт полное состояние выдачи в JSON
  // внутри разметки, поэтому это разбор состояния, а не скрейпинг HTML.
  // Официальный API закрыт для всех неавторизованных с апреля 2026 (INC-022),
  // а приложение на dev.hh.ru кандидату недоступно (решение владельца B214).
  | 'hh_search'
  | 'career_site'
  // Площадка, до которой сервер не дотягивается по праву: анти-бот отвечает
  // `403` честному агенту, либо `robots.txt` запрещает обход. Читается только
  // в браузерной сессии самого кандидата (ADR-009, B206). Такой источник
  // зарегистрирован, но серверный сборщик обязан на нём падать, а не
  // возвращать пустой успех (B199).
  | 'browser_session'
  | 'direct';

export interface VacancySalary {
  from?: number;
  to?: number;
  currency?: string;
  gross?: boolean;
}

export interface VacancyProvenance {
  sourceType: VacancySourceType;
  sourceId: string;
  /** Название площадки из реестра: кандидат читает его, а не тип адаптера (PRB-017). */
  sourceName?: string;
  sourceUrl: string;
  externalId?: string;
  channelName?: string;
  observedAt: string;
}

export interface UnifiedVacancy {
  id: string;
  fingerprint: string;
  title: string;
  company: string;
  location?: string;
  isRemote?: boolean;
  salary?: VacancySalary;
  description: string;
  requiredSkills: string[];
  employmentType?: string;
  experienceLevel?: string;
  responsibilities?: string[];
  qualifications?: string[];
  niceToHave?: string[];
  benefits?: string[];
  aboutCompany?: string;
  contactInfo?: string;
  fullDescription?: string;
  postType?: 'vacancy' | 'candidate_resume' | 'ad' | 'digest';
  url: string;
  provenance: VacancyProvenance;
  publishedAt: string;
  status: 'active' | 'archived';
  archivedAt?: string;
}

export interface VacancyCompanyFeatures {
  readonly relocation?: boolean;
  readonly currencyRemote?: boolean;
  readonly russianAbroad?: boolean;
  readonly fullRemote?: boolean;
  readonly industry?: string;
  readonly city?: string;
  readonly country?: string;
  readonly coordinates?: { readonly lat: number; readonly lng: number };
  readonly atsProvider?: string;
  readonly atsBoardUrl?: string;
}

export interface VacancyCluster {
  id: string;
  canonicalTitle: string;
  canonicalCompany: string;
  canonicalLocation?: string;
  isRemote: boolean;
  salary?: VacancySalary;
  descriptionSummary: string;
  skills: string[];
  primaryUrl: string;
  sources: VacancyProvenance[];
  firstObservedAt: string;
  lastSeenAt: string;
  status: 'active' | 'archived';
  vacanciesCount: number;
  companyFeatures?: VacancyCompanyFeatures;
}

export interface VacancyMatchExplanation {
  clusterId: string;
  /** Совпадение названия вакансии с целевыми ролями кандидата. */
  roleMatch: VacancyRoleMatch;
  /**
   * Требования вакансии: сколько перечислено и сколько из них подтверждено.
   * `undefined` — вакансия требований не перечислила, сравнивать не с чем;
   * выдавать это за соответствие продукту запрещено (PRB-016).
   */
  requirements?: VacancyRequirementCoverage;
  matchingPoints: string[];
  missingPoints: string[];
  /**
   * Сколько требований совпало и сколько нет на самом деле. Списки уезжают на
   * экран обрезанными до видимых трёх (INC-029), а счёт покрытия обязан
   * остаться настоящим.
   */
  matchingCount?: number;
  missingCount?: number;
  summary: string;
  calculatedAt: string;
}

export interface VacancySourceConfig {
  id: string;
  name: string;
  type: VacancySourceType;
  enabled: boolean;
  targetUrl: string;
  refreshIntervalMinutes: number;
  lastSyncAt?: string;
  lastStatus?: 'healthy' | 'degraded' | 'error';
  lastErrorMessage?: string;
  itemsFoundTotal: number;
  itemsActiveTotal: number;
  /** Правомерность и доступность адреса площадки из реестра (B199/B200/B204). */
  addressStatus?: import('../vacancies/defaultVacancySources').VacancyAddressStatus;
  /**
   * True when the endpoint answers nothing usable without a search term, so a
   * query-less scheduled sync skips it instead of recording an empty success
   * (B164).
   */
  requiresQuery?: boolean;
  /**
   * Как эта лента называет работодателя в заголовке записи. Ставится только
   * тем площадкам, чья форма измерена на живой ленте: агрегатор без объявленной
   * формы оставляет работодателя неназванным, а не подставляет своё имя.
   */
  employerShape?: import('../connectors/rssFeedParser').RssEmployerShape;
  /**
   * Явное разрешение владельца опрашивать адрес, который `robots.txt`
   * площадки запрещает. Только словами, с датой и основанием — без него
   * запрет площадки действует (B204, B217).
   */
  robotsOverride?: RobotsOverride;
}

export interface RobotsOverride {
  readonly grantedBy: 'owner';
  /** Дата решения, ISO. */
  readonly grantedOn: string;
  /** Почему это не обход: документ площадки, разрешающий именно такое чтение. */
  readonly basis: string;
}
