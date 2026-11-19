import type {
  CandidateFootprintAudit,
  CandidateFootprintFinding,
} from '../../shared/candidateFootprint';
import type { ConsistencyDiscrepancy } from '../../shared/candidateReputation';
import { pluralRu } from '../../shared/pluralRu';
import {
  FOOTPRINT_CATEGORY_TITLES,
  FOOTPRINT_LEVEL_LABELS,
  FOOTPRINT_RISK_CATEGORIES,
  FOOTPRINT_RISK_LEVELS,
  type FootprintRiskAction,
  type FootprintRiskCategory,
  type FootprintRiskCategoryId,
  type FootprintRiskItem,
  type FootprintRiskLevel,
  type FootprintRiskState,
  type FootprintRiskSummary,
} from '../../shared/footprintRisk';

/**
 * B667: сводка следа из уже сохранённых находок. Чистый расчёт: ничего не
 * ищет и не пишет. Наружу уходят только заголовок, описание и ссылка находки —
 * без инструмента, запроса и квитанций.
 */
interface Rule {
  readonly category: FootprintRiskCategoryId;
  readonly level: FootprintRiskLevel;
  readonly action: FootprintRiskAction;
}

const CLOSE: FootprintRiskAction = { kind: 'close_account', label: 'Закрыть аккаунты' };
const CHECK: FootprintRiskAction = { kind: 'check_now', label: 'Проверить' };
const HIDE: FootprintRiskAction = { kind: 'hide', label: 'Скрыть' };
const ADD: FootprintRiskAction = { kind: 'add_to_profile', label: 'В профиль' };
const FIX: FootprintRiskAction = { kind: 'ask_to_fix', label: 'Попросить исправить' };

const NEEDS_CHECK: Rule = { category: 'needs_check', level: 'important', action: CHECK };
const STALE: Rule = { category: 'stale_profile', level: 'low', action: HIDE };
const USEFUL: Rule = { category: 'useful_evidence', level: 'useful', action: ADD };

/** Категория, уровень и действие по виду находки. Неизвестный вид — «нужно проверить». */
function ruleFor(finding: CandidateFootprintFinding): Rule {
  const unsure = finding.review === 'unreviewed' && finding.automatedMatch === 'unknown';
  switch (finding.kind) {
    case 'breach':
      return { category: 'personal_data', level: 'high', action: CLOSE };
    case 'metadata':
      return { category: 'personal_data', level: 'low', action: HIDE };
    case 'secret':
      return NEEDS_CHECK;
    case 'archive':
      return STALE;
    case 'profile':
      if (finding.staleAccount) return STALE;
      return unsure ? NEEDS_CHECK : USEFUL;
    case 'mention':
      return unsure ? NEEDS_CHECK : USEFUL;
    default:
      return NEEDS_CHECK;
  }
}

const TOOL_NAMES =
  /(?<![\p{L}\p{N}])(sherlock|maigret|hibp|have i been pwned|wayback(?: machine)?|internet archive|web\.archive\.org|cdx|exa|exiftool)(?![\p{L}\p{N}])/giu;

/** Заголовок без названия инструмента: «Sherlock: профиль» → «профиль». */
function cleanTitle(title: string): string {
  return title
    .replace(TOOL_NAMES, '')
    .replace(/\(\s*\)/gu, '')
    .replace(/\s{2,}/gu, ' ')
    .replace(/^[\s:—–-]+|[\s:—–-]+$/gu, '')
    .trim();
}

/** Описание без предложений, где назван инструмент или способ поиска. */
function cleanDetail(detail: string): string {
  return detail
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => !sentence.match(TOOL_NAMES))
    .join(' ')
    .trim();
}

const ARCHIVED_PAGE = /\/web\/\d+[a-z_]*\/(https?:\/\/.+)$/u;

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    // Копия из веб-архива: отдаём адрес самой страницы, а не способ, которым её нашли.
    const archived = url.hostname === 'web.archive.org' && url.href.match(ARCHIVED_PAGE);
    if (archived) return safeUrl(archived[1]);
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function findingItem(finding: CandidateFootprintFinding): FootprintRiskItem {
  const rule = ruleFor(finding);
  // Отметка чек-листа или подтверждённое удаление (B382) — находка разобрана.
  const resolved = finding.checklistMark !== undefined || finding.removal?.result === 'removed';
  return {
    id: finding.id,
    category: rule.category,
    level: rule.level,
    levelLabel: FOOTPRINT_LEVEL_LABELS[rule.level],
    title: cleanTitle(finding.title) || 'Находка',
    detail: cleanDetail(finding.detail),
    url: safeUrl(finding.url),
    observedAt: finding.observedAt || null,
    resolved,
    action: resolved ? null : rule.action,
    findingId: finding.id,
    mismatch: null,
    ...(finding.removal ? { removal: finding.removal } : {}),
  };
}

/**
 * Находка, к которой относится расхождение: та же страница или та же площадка
 * (источник расхождения бывает адресом, а бывает названием площадки).
 */
function linkedFinding(
  source: string,
  findings: readonly CandidateFootprintFinding[],
): CandidateFootprintFinding | undefined {
  const url = safeUrl(source);
  if (url) return findings.find((finding) => safeUrl(finding.url) === url);
  const name = source.trim().toLocaleLowerCase('ru');
  if (name.length < 3) return undefined;
  return findings.find((finding) =>
    `${finding.title} ${finding.url ?? ''}`.toLocaleLowerCase('ru').includes(name),
  );
}

/** Расхождение с резюме привязываем к находке. */
function mismatchItem(
  discrepancy: ConsistencyDiscrepancy,
  findings: readonly CandidateFootprintFinding[],
): FootprintRiskItem {
  const linked = linkedFinding(discrepancy.externalSource, findings);
  const url = safeUrl(discrepancy.externalSource) ?? safeUrl(linked?.url);
  const level: FootprintRiskLevel = discrepancy.severity === 'critical' ? 'high' : 'low';
  return {
    id: `mismatch:${discrepancy.id}`,
    category: 'resume_mismatch',
    level,
    levelLabel: FOOTPRINT_LEVEL_LABELS[level],
    title:
      cleanTitle(`${discrepancy.field}: «${discrepancy.externalValue}»`) || 'Расхождение с резюме',
    detail: cleanDetail(discrepancy.suggestion),
    url,
    observedAt: linked?.observedAt ?? null,
    resolved: false,
    action: FIX,
    findingId: linked?.id ?? null,
    mismatch: {
      field: cleanTitle(discrepancy.field),
      profileValue: discrepancy.candidateValue,
      foundValue: cleanTitle(discrepancy.externalValue),
    },
  };
}

const LEVEL_RANK = new Map(FOOTPRINT_RISK_LEVELS.map((level, index) => [level, index]));
const WHERE_TITLES = 2;

function categoryOf(
  id: FootprintRiskCategoryId,
  items: readonly FootprintRiskItem[],
): FootprintRiskCategory {
  const own = items.filter((item) => item.category === id);
  const level = own[0]?.level ?? null;
  return {
    id,
    title: FOOTPRINT_CATEGORY_TITLES[id],
    count: own.length,
    level,
    levelLabel: level ? FOOTPRINT_LEVEL_LABELS[level] : null,
    where: own
      .slice(0, WHERE_TITLES)
      .map((item) => item.title)
      .join(' · '),
  };
}

function headlineOf(total: number, toRemove: number): string {
  if (total === 0) return 'Ничего рискового';
  const found = pluralRu(total, ['находка', 'находки', 'находок']);
  return toRemove > 0 ? `${found}, ${toRemove} стоит убрать` : `${found}, ничего рискового`;
}

const STATE: Record<CandidateFootprintAudit['state'], FootprintRiskState> = {
  pending: 'checking',
  completed: 'ready',
  failed: 'failed',
};

/** Сводка следа: категории со счётчиками, находки по порядку риска и итог. */
export function buildFootprintRiskSummary(
  audit: CandidateFootprintAudit | null,
  discrepancies: readonly ConsistencyDiscrepancy[],
  options: { readonly checkRunning?: boolean } = {},
): FootprintRiskSummary {
  const findings = (audit?.findings ?? []).filter(
    (finding) => finding.review !== 'not_self' && finding.review !== 'hidden',
  );
  const items = [
    ...findings.map(findingItem),
    ...(audit ? discrepancies.map((discrepancy) => mismatchItem(discrepancy, findings)) : []),
  ].sort((a, b) => (LEVEL_RANK.get(a.level) ?? 0) - (LEVEL_RANK.get(b.level) ?? 0));
  const toRemove = items.filter((item) => item.level !== 'useful' && !item.resolved).length;
  // «Идёт проверка» верим, только если она и правда идёт: оборванную показываем сорванной.
  const stalled = audit?.state === 'pending' && options.checkRunning === false;
  const state = !audit ? 'not_checked' : stalled ? 'failed' : STATE[audit.state];
  return {
    state,
    checkedAt: audit?.completedAt ?? null,
    total: items.length,
    toRemove,
    headline: state === 'ready' ? headlineOf(items.length, toRemove) : null,
    categories: FOOTPRINT_RISK_CATEGORIES.map((id) => categoryOf(id, items)),
    items,
  };
}
