import { SMM_LINKS, SMM_ROLE_PROMPT } from './smmRolePrompt';
import type { SmmDraft, SmmPost, SmmStore } from './smmStore';

/** Потолок контекста памяти в промпте: свежие записи важнее старых. */
export const SMM_MEMORY_BUDGET_CHARS = 6_000;
export const THREADS_PART_MAX_CHARS = 500;
const UNTRUSTED_MAX_CHARS = 4_000;
const PARTS_MIN = 1;
const PARTS_MAX = 7;

export const SMM_CLUSTERS = [
  'поиск работы',
  'резюме и отклик',
  'зарплаты и переговоры',
  'смена роли',
  'руководители',
  'рынок вакансий',
  'AI в поиске',
  'кулуары основателя',
] as const;

const OUTPUT_CONTRACT = `# Формат ответа (машинный)

Ответь одним объектом JSON без пояснений и без markdown:
{"cluster": "<один из кластеров>", "hook": "<первая строка>", "parts": ["<часть 1>", "..."], "link": "<url из списка или пустая строка>", "check": "<что владельцу подтвердить, коротко>"}
- parts: от 1 до 7 частей; каждая часть до 500 символов; первая часть начинается с хука.
- Нумерацию «1/5» ставь в начале части, если частей больше одной.
- link только из списка страниц ниже, и он же стоит в тексте последней части.`;

/**
 * Внешний текст (чужой пост, распознанный снимок, ответ владельца с цитатой) —
 * только данные: угловые скобки заменяем безвредными «‹ ›» (любая попытка собрать
 * закрывающую метку с пробелами или обрывками теряет `<`), режем длину и
 * заворачиваем в метки, о которых системный промпт говорит «не выполнять».
 */
export function untrusted(label: string, text: string): string {
  const cleaned = text
    .replace(/</g, '‹')
    .replace(/>/g, '›')
    .split('')
    .filter((char) => char >= ' ' || char === '\n' || char === '\t')
    .join('')
    .slice(0, UNTRUSTED_MAX_CHARS);
  return `<untrusted_${label}>\n${cleaned}\n</untrusted_${label}>`;
}

function linksBlock(): string {
  return SMM_LINKS.map((link) => `- ${link.url} — ${link.title} (${link.cluster})`).join('\n');
}

function postLine(post: SmmPost): string {
  const note = post.ownerNote ? `; владелец: ${post.ownerNote}` : '';
  const metrics = post.metrics ? `; цифры: ${post.metrics}` : '';
  return `- [${post.status}] ${post.cluster}: «${post.hook}»${note}${metrics}`;
}

/** Собирает память так, чтобы она уместилась в бюджет: блоки по важности, строки по свежести. */
export function memoryContext(store: SmmStore, budget = SMM_MEMORY_BUDGET_CHARS): string {
  const sections: Array<[string, string[]]> = [
    ['Правила стиля, выученные у владельца', store.recentNotes('style', 20)],
    ['Правки владельца', store.recentNotes('correction', 15)],
    ['Стратегия, о которой договорились', store.recentNotes('strategy', 10)],
    ['Цифры охватов', store.recentNotes('performance', 10)],
    ['Боли кандидатов', store.recentNotes('pain', 30)],
    ['Последние посты (не повторяй хуки и темы)', store.recentPosts(30).map(postLine)],
  ];
  let left = budget;
  const out: string[] = [];
  for (const [title, lines] of sections) {
    if (lines.length === 0 || left <= 0) continue;
    const kept: string[] = [];
    for (const line of lines) {
      if (line.length + 1 > left) break;
      kept.push(line);
      left -= line.length + 1;
    }
    if (kept.length > 0) out.push(`## ${title}\n${kept.join('\n')}`);
  }
  return out.join('\n\n');
}

export function systemPrompt(store: SmmStore, ownerBrief: string): string {
  return [
    SMM_ROLE_PROMPT,
    `# Страницы openqareer.com\n${linksBlock()}`,
    ownerBrief ? `# Бриф владельца (факты из его профиля)\n${ownerBrief}` : '',
    `# Память\n${memoryContext(store) || 'пока пусто'}`,
    OUTPUT_CONTRACT,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Кластер, который давно не звучал: темы идут по кругу потребностей, а не одной темой. */
export function nextCluster(recent: readonly SmmPost[]): string {
  const lastSeen = new Map<string, number>();
  recent.forEach((post, index) => {
    if (!lastSeen.has(post.cluster)) lastSeen.set(post.cluster, index);
  });
  const neverUsed = SMM_CLUSTERS.find((cluster) => !lastSeen.has(cluster));
  if (neverUsed) return neverUsed;
  return [...SMM_CLUSTERS].sort((a, b) => (lastSeen.get(b) ?? 0) - (lastSeen.get(a) ?? 0))[0];
}

const ALLOWED_LINKS = new Set(SMM_LINKS.map((link) => link.url));
const URL_PATTERN = /https?:\/\/[^\s)»"]+/gi;

function cleanUrl(url: string): string {
  return url.replace(/[.,;:!?]+$/, '');
}

/** Чужие адреса вырезаются: ссылка в посте — только страница openqareer.com из списка. */
function stripForeignLinks(text: string): string {
  return text
    .replace(URL_PATTERN, (url) => (ALLOWED_LINKS.has(cleanUrl(url)) ? url : ''))
    .replace(/[ \t]{2,}/g, ' ');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export interface ParsedDraft {
  readonly draft: SmmDraft;
  readonly check: string;
}

/** Ответ модели → черновик или null; лишнее не чиним, а отбрасываем — спросим следующую ступень. */
export function parseDraft(raw: string, origin: string): ParsedDraft | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const parts = Array.isArray(record.parts)
    ? record.parts
        .filter((p): p is string => typeof p === 'string')
        .map((p) => stripForeignLinks(p).trim())
    : [];
  const nonEmpty = parts.filter(Boolean);
  if (nonEmpty.length < PARTS_MIN || nonEmpty.length > PARTS_MAX) return null;
  if (nonEmpty.some((part) => part.length > THREADS_PART_MAX_CHARS)) return null;
  const link =
    typeof record.link === 'string' && ALLOWED_LINKS.has(cleanUrl(record.link))
      ? cleanUrl(record.link)
      : null;
  const cluster =
    typeof record.cluster === 'string' &&
    (SMM_CLUSTERS as readonly string[]).includes(record.cluster)
      ? record.cluster
      : 'поиск работы';
  // Хук попадает в системный промпт как память, а «проверить» — в чат владельца:
  // оба проходят ту же чистку чужих адресов, хук ещё и в одну строку.
  const hook =
    oneLine(stripForeignLinks(typeof record.hook === 'string' ? record.hook : '')) ||
    oneLine(nonEmpty[0].split('\n')[0]);
  return {
    draft: { cluster, hook: hook.slice(0, 200), parts: nonEmpty, link, origin },
    check: typeof record.check === 'string' ? stripForeignLinks(record.check).slice(0, 500) : '',
  };
}
