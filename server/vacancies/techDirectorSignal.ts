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
 * Требования вакансии по id кластера; `null` — их ещё не разобрали, `undefined` — хранилища
 * требований в процессе нет: тогда остаётся прежнее совпадение по названию.
 */
export type RequirementsReader = (
  clusterId: string,
) => readonly RequirementText[] | null | undefined;

interface RoleItem {
  readonly cluster: { readonly id: string; readonly canonicalTitle: string };
}

const MIN_IT_GROUPS = 2;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED = 20_000;

/** Группы словаря ИТ и разработки: одна группа — один навык, сколько бы раз он ни встретился. */
const IT_GROUPS: readonly RegExp[] = [
  /\bsoftware\b|программн\S* (?:обеспечен|продукт)|(?<!\p{L})ПО(?!\p{L})|\bsaas\b/u,
  /разработк\S* (?:по|продукт|програм|сервис|систем|приложен|платформ)|software development|\b(?:development|engineering) team|команд\S* разработ|процесс\S* разработ|заказн\S* разработ|тимлид|team ?lead/iu,
  /архитектур\S* (?:систем|приложен|it|ит)|system design|solution architect|microservice|микросервис|\bapi\b|\bhighload|высоконагруж/iu,
  /\bcloud\b|облач|\baws\b|\bgcp\b|\bazure\b|kubernetes|\bk8s\b|docker|terraform/iu,
  /devops|ci\/cd|\bsre\b|observability/iu,
  /\b(?:python|java|golang|go|typescript|javascript|node\.?js|php|c#|\.net|kotlin|swift|rust|scala|react|vue|angular)\b/iu,
  /\bsql\b|postgres|mysql|clickhouse|mongodb|redis|kafka|баз\S* данных/iu,
  /\bdata (?:platform|engineering|pipeline)|\bmachine learning|\bml\b|\bllm\b|\bai\b|искусственн\S* интеллект|машинн\S* обучен|big data|\bdwh\b/iu,
  /(?<!\p{L})ИИ(?!\p{L})/u,
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
  return IT_GROUPS.filter((group) => group.test(text)).length >= MIN_IT_GROUPS;
}

let reader: RequirementsReader | undefined;
const verdicts = new Map<string, { readonly it: boolean; readonly at: number }>();

/** Ставит процесс, у которого есть хранилище требований; без него — прежнее совпадение по названию. */
export function setRequirementsReader(next: RequirementsReader | undefined): void {
  reader = next;
  verdicts.clear();
}

function itVerdict(item: RoleItem, read: RequirementsReader, now: number): boolean {
  const known = verdicts.get(item.cluster.id);
  if (known && now - known.at < CACHE_TTL_MS) return known.it;
  const requirements = read(item.cluster.id);
  if (requirements === undefined) return true;
  const it = hasItSignal(requirements, item.cluster.canonicalTitle);
  if (verdicts.size >= MAX_CACHED) verdicts.clear();
  verdicts.set(item.cluster.id, { it, at: now });
  return it;
}

/** `sameCareerRole` плюс признак ИТ для общего «Технический директор». */
export function vacancyInCareerRole(item: RoleItem, role: string, now = Date.now()): boolean {
  const title = item.cluster.canonicalTitle;
  if (!sameCareerRole(title, role)) return false;
  if (!reader || !needsItSignal(title)) return true;
  return itVerdict(item, reader, now);
}
