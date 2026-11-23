import { GO_LANGUAGE } from '../../shared/goLanguage';
import { sameCareerRole } from './careerRoleKey';

/**
 * B766: «Технический директор» — это и CTO, и главный инженер завода. Название без CTO вне скобок
 * относится к роли кандидата, только если сама вакансия говорит об ИТ: в её требованиях навыки
 * хотя бы двух групп словаря ниже. Если требований нет — решает пометка ИТ в названии.
 * Требования есть, а ИТ в них нет — название вакансию не спасает (решение оркестратора 23.11).
 */
export interface RequirementText {
  readonly text: string;
  readonly label?: string;
}

/**
 * Требования вакансий пачкой по id кластеров: нет id в ответе — их ещё не разобрали; `undefined` —
 * хранилища требований в процессе нет, тогда остаётся прежнее совпадение по названию.
 */
export type RequirementsReader = (
  clusterIds: readonly string[],
) => ReadonlyMap<string, readonly RequirementText[]> | undefined;

interface RoleItem {
  readonly cluster: { readonly id: string; readonly canonicalTitle: string };
}

const MIN_IT_SKILLS = 2;
const MAX_CACHED = 20_000;

/** Словарь ИТ и разработки по группам; навык — каждое разное слово словаря в требованиях. */
const IT_GROUPS: readonly RegExp[] = [
  /\bsoftware\b|программн\S* (?:обеспечен|продукт)|(?<!\p{L})ПО(?!\p{L})|\bsaas\b/u,
  /разработк\S* (?:по|продукт|програм|сервис|систем|приложен|платформ)|software development|\b(?:development|engineering) team|команд\S* разработ|процесс\S* разработ|заказн\S* разработ|тимлид|team ?lead/iu,
  /архитектур\S* (?:систем|приложен|it|ит)|system design|solution architect|microservice|микросервис|\bapi\b|\bhighload|высоконагруж/iu,
  /\bcloud\b|облач|\baws\b|\bgcp\b|\bazure\b|kubernetes|\bk8s\b|docker|terraform/iu,
  /devops|ci\/cd|\bsre\b|observability/iu,
  /\b(?:python|java|golang|typescript|javascript|node\.?js|php|c#|\.net|kotlin|swift|rust|scala|react|vue|angular)\b/iu,
  /\bsql\b|postgres|mysql|clickhouse|mongodb|redis|kafka|баз\S* данных/iu,
  /\bdata (?:platform|engineering|pipeline)|\bmachine learning|\bml\b|\bllm\b|\bai\b|искусственн\S* интеллект|машинн\S* обучен|big data|\bdwh\b/iu,
  /(?<!\p{L})ИИ(?!\p{L})/u,
  // Go — только язык: «go-to-market» и «go live» не ИТ (B741).
  GO_LANGUAGE,
  /(?:it|ит)[- ]инфраструктур|\bit infrastructure|информационн|кибербезопасн|cybersecurity|\blinux\b|\bwindows server|vmware|виртуализац|zabbix|сетев\S* оборудован/iu,
  /\bweb\b|веб|мобильн\S* приложен|\bmobile app|\bios\b|\bandroid\b|backend|frontend|бэкенд|фронтенд|full-?stack/iu,
  /\bscrum\b|\bagile\b|\bsdlc\b|code review|ревью кода|техническ\S* долг|tech(?:nical)? debt/iu,
];

const GENERIC_TITLE = /техническ\S* директор|technical director/iu;
const CTO_IN_TITLE = /\bCTO\b|chief technology/iu;
/** Пометка ИТ в названии — только для вакансии без перечисленных требований. */
const IT_TITLE_MARKER =
  /\(\s*(?:CTO|СТО)\s*\)|по разработке|\bIT\b|(?<!\p{L})ИТ(?!\p{L})|digital|цифров|\bdata\b|данн|\bAI\b|(?<!\p{L})ИИ(?!\p{L})/iu;

function outsideBrackets(title: string): string {
  return title.replace(/\([^)]*\)/gu, ' ');
}

/** Название, в котором роль решает только «Технический директор»: CTO вне скобок нет. */
export function needsItSignal(title: string): boolean {
  const outside = outsideBrackets(title);
  return GENERIC_TITLE.test(outside) && !CTO_IN_TITLE.test(outside);
}

export function hasItSignal(
  requirements: readonly RequirementText[] | null,
  title: string,
): boolean {
  if (!requirements || requirements.length === 0) return IT_TITLE_MARKER.test(title);
  const text = requirements.map((item) => `${item.label ?? ''} ${item.text}`).join('\n');
  return itSkills(text).size >= MIN_IT_SKILLS;
}

/** Разные навыки ИТ в тексте: «Linux» и «VMware» — два, хоть и из одной группы (решение 23.11). */
function itSkills(text: string): ReadonlySet<string> {
  return new Set(
    IT_GROUPS.flatMap((group) =>
      [...text.matchAll(new RegExp(group.source, `${group.flags}g`))].map((match) =>
        match[0].toLowerCase(),
      ),
    ),
  );
}

let reader: RequirementsReader | undefined;
let verdicts = new Map<string, boolean>();

/** Ставит процесс, у которого есть хранилище требований; без него — прежнее совпадение по названию. */
export function setRequirementsReader(next: RequirementsReader | undefined): void {
  reader = next;
  verdicts = new Map();
}

/**
 * Одно чтение подборки — один запрос требований на все общие «Технический директор» в ней
 * (решение оркестратора 23.11): до проверки ролей, а не по запросу на вакансию.
 */
export function primeRoleRequirements(items: readonly RoleItem[]): void {
  if (!reader) return;
  const generic = items.filter((row) => needsItSignal(row.cluster.canonicalTitle));
  verdicts = generic.length ? verdictsOf(generic, reader) : new Map();
}

function verdictsOf(items: readonly RoleItem[], read: RequirementsReader): Map<string, boolean> {
  const ids = [...new Set(items.map((row) => row.cluster.id))];
  const found = read(ids);
  if (!found) return new Map();
  return new Map(
    items.map((row) => [
      row.cluster.id,
      hasItSignal(found.get(row.cluster.id) ?? null, row.cluster.canonicalTitle),
    ]),
  );
}

function itVerdict(item: RoleItem, read: RequirementsReader): boolean {
  const known = verdicts.get(item.cluster.id);
  if (known !== undefined) return known;
  const found = read([item.cluster.id]);
  if (!found) return true;
  const it = hasItSignal(found.get(item.cluster.id) ?? null, item.cluster.canonicalTitle);
  if (verdicts.size >= MAX_CACHED) verdicts = new Map();
  verdicts.set(item.cluster.id, it);
  return it;
}

/**
 * B770 (prod 23.11): `roleCounts` и `facets` сверяли каждое название с каждой ролью на каждой сборке.
 * Совпадение зависит только от названия и роли — одно на процесс; 300 000 пар (~20 000 названий × роли).
 */
const MAX_TITLE_ROLE_ENTRIES = 300_000;
let titleRoleLimit = MAX_TITLE_ROLE_ENTRIES;
let titleRoles = new Map<string, Map<string, boolean>>();
let titleRoleEntries = 0;

/** Пар название–роль в кэше — потолок на пары, а не на названия: роль приходит из запроса. */
export function titleRoleCacheSize(): number {
  return titleRoleEntries;
}

/** Для тестов: потолок пар; без аргумента — рабочий. */
export function setTitleRoleCacheLimit(limit = MAX_TITLE_ROLE_ENTRIES): void {
  titleRoleLimit = limit;
}

function titleInRole(title: string, role: string): boolean {
  const known = titleRoles.get(title)?.get(role);
  if (known !== undefined) return known;
  const same = sameCareerRole(title, role);
  if (titleRoleEntries >= titleRoleLimit) {
    titleRoles = new Map();
    titleRoleEntries = 0;
  }
  const roles = titleRoles.get(title);
  if (roles) roles.set(role, same);
  else titleRoles.set(title, new Map([[role, same]]));
  titleRoleEntries += 1;
  return same;
}

/** `sameCareerRole` плюс признак ИТ для общего «Технический директор». */
export function vacancyInCareerRole(item: RoleItem, role: string): boolean {
  const title = item.cluster.canonicalTitle;
  if (!titleInRole(title, role)) return false;
  if (!reader || !needsItSignal(title)) return true;
  return itVerdict(item, reader);
}
