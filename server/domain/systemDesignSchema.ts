/**
 * B647: схема System Design из ответа кандидата на тренировке. Без модели:
 * компоненты ищутся по словарю признаков (RU/EN), связи — по стрелкам,
 * глаголам потока и «из X в Y» внутри одного предложения. Меньше двух
 * компонентов — схемы нет (`null`), разбор идёт только по тексту.
 */
import { linksOfSentence } from './systemDesignSchemaLinks';

export const SCHEMA_MAX_NODES = 20;
export const SCHEMA_MAX_LINKS = 40;
export const SCHEMA_LABEL_LIMIT = 60;
const QUOTE_LIMIT = 200;

export const SCHEMA_NODE_KINDS = [
  'client',
  'cdn',
  'load_balancer',
  'gateway',
  'service',
  'queue',
  'worker',
  'database',
  'cache',
  'storage',
  'search',
  'monitoring',
] as const;
export type SchemaNodeKind = (typeof SCHEMA_NODE_KINDS)[number];

export interface SchemaNode {
  readonly id: string;
  readonly label: string;
  readonly kind: SchemaNodeKind;
  readonly quote: string | null;
}

export interface SchemaLink {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly quote: string | null;
}

export interface SystemDesignSchema {
  readonly nodes: readonly SchemaNode[];
  readonly links: readonly SchemaLink[];
}

/** Упоминание компонента в предложении: позиция нужна для связей. */
export interface SchemaMention {
  readonly id: string;
  readonly kind: SchemaNodeKind;
  readonly label: string;
  readonly start: number;
  readonly end: number;
}

const NB = '(?<![\\p{L}\\p{N}])';
const NA = '(?![\\p{L}\\p{N}])';
const cue = (body: string): RegExp => new RegExp(`${NB}(?:${body})`, 'giu');

/** Конкретные технологии стоят раньше общих слов: подпись узла берётся у первой найденной. */
const COMPONENT_CUES: ReadonlyArray<readonly [SchemaNodeKind, string, RegExp]> = [
  [
    'client',
    'Клиент',
    cue(`клиент|client${NA}|браузер|frontend|фронтенд|мобильн\\p{L}* приложени`),
  ],
  ['cdn', 'CDN', cue(`cdn${NA}`)],
  ['load_balancer', 'Балансировщик', cue(`балансировщик|балансер|load balancer|nginx${NA}`)],
  ['gateway', 'Шлюз API', cue(`шлюз|api gateway|gateway|api${NA}`)],
  ['queue', 'Kafka', cue(`kafka${NA}`)],
  ['queue', 'RabbitMQ', cue(`rabbitmq${NA}`)],
  ['queue', 'Очередь', cue(`очеред|queue|брокер`)],
  ['worker', 'Воркер', cue(`воркер|worker|обработчик`)],
  ['database', 'PostgreSQL', cue(`postgres(?:ql)?${NA}`)],
  ['database', 'MySQL', cue(`mysql${NA}`)],
  ['database', 'MongoDB', cue(`mongo(?:db)?${NA}`)],
  ['database', 'ClickHouse', cue(`clickhouse${NA}`)],
  ['database', 'База данных', cue(`баз(?:а|у|е|ы|ой|ам|ами)${NA}|бд${NA}|database|db${NA}`)],
  ['cache', 'Redis', cue(`redis${NA}`)],
  ['cache', 'Кэш', cue(`кэш|кеш|cache`)],
  ['storage', 'S3', cue(`s3${NA}`)],
  ['storage', 'Хранилище', cue(`хранилищ|object storage|storage${NA}`)],
  ['search', 'Elasticsearch', cue(`elasticsearch|opensearch`)],
  ['search', 'Поисковый индекс', cue(`поисков\\p{L}* индекс|search index`)],
  ['monitoring', 'Мониторинг', cue(`монитор|метрик|алерт|metrics|prometheus|grafana`)],
];

const SERVICE_CUE =
  /(?<![\p{L}\p{N}])(?:микро)?сервис\p{L}*(?:\s+([\p{L}-]{3,}))?|(?<![\p{L}\p{N}])services?(?![\p{L}\p{N}])/giu;
const SERVICE_STOP_WORDS = new Set([
  'для',
  'или',
  'который',
  'которая',
  'которое',
  'которые',
  'через',
  'также',
  'отдельно',
  'пишет',
  'читает',
  'кладёт',
  'кладет',
  'отправляет',
  'вызывает',
  'получает',
  'берёт',
  'берет',
  'публикует',
  'передаёт',
  'передает',
  'забирает',
  'обращается',
  'хранит',
]);

function sentencesOf(answer: string): string[] {
  return answer
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function capText(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/** Короткий стабильный хэш подписи: id сервиса не зависит от порядка в ответе. */
function labelHash(label: string): string {
  let hash = 0x811c9dc5;
  for (const char of label) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 6);
}

function serviceMention(match: RegExpMatchArray): SchemaMention {
  const word = match[1]?.toLocaleLowerCase('ru-RU');
  const named = word && !SERVICE_STOP_WORDS.has(word);
  const label = named ? capText(`Сервис ${word}`, SCHEMA_LABEL_LIMIT) : 'Сервис';
  const start = match.index ?? 0;
  const length = named ? match[0].length : match[0].length - (match[1]?.length ?? 0);
  return {
    id: named ? `service-${labelHash(label.toLocaleLowerCase('ru-RU'))}` : 'service',
    kind: 'service',
    label,
    start,
    end: start + length,
  };
}

/** Все упоминания компонентов в тексте по позиции; один компонент подряд — одно упоминание. */
export function mentionsIn(text: string): SchemaMention[] {
  const dictionary = COMPONENT_CUES.flatMap(([kind, label, pattern]) =>
    [...text.matchAll(pattern)].map((match) => ({
      id: kind,
      kind,
      label,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    })),
  );
  const services = [...text.matchAll(SERVICE_CUE)].map(serviceMention);
  const sorted = [...dictionary, ...services].sort((a, b) => a.start - b.start);
  return sorted.filter((mention, index) => index === 0 || sorted[index - 1]!.id !== mention.id);
}

/** Id узлов, названных в тексте (например, в цитате критерия разбора). */
export function mentionedNodeIds(text: string): string[] {
  return [...new Set(mentionsIn(text).map((mention) => mention.id))];
}

function labelFor(kind: SchemaNodeKind, answer: string, fallback: string): string {
  if (kind === 'service') return fallback;
  const entry = COMPONENT_CUES.find(
    ([entryKind, , pattern]) => entryKind === kind && answer.match(pattern),
  );
  return entry?.[1] ?? fallback;
}

function nodesOf(answer: string, sentences: readonly string[]): SchemaNode[] {
  const firstSeen = new Map<string, { mention: SchemaMention; sentence: string }>();
  for (const sentence of sentences) {
    for (const mention of mentionsIn(sentence)) {
      if (!firstSeen.has(mention.id)) firstSeen.set(mention.id, { mention, sentence });
    }
  }
  return [...firstSeen.values()].slice(0, SCHEMA_MAX_NODES).map(({ mention, sentence }) => ({
    id: mention.id,
    label: labelFor(mention.kind, answer, mention.label),
    kind: mention.kind,
    quote: capText(sentence, QUOTE_LIMIT),
  }));
}

function linksOf(sentences: readonly string[], nodeIds: ReadonlySet<string>): SchemaLink[] {
  const seen = new Set<string>();
  return sentences
    .flatMap((sentence) =>
      linksOfSentence(
        sentence,
        mentionsIn(sentence).filter((mention) => nodeIds.has(mention.id)),
      ).map((link) => ({ ...link, quote: capText(sentence, QUOTE_LIMIT) })),
    )
    .filter((link) => {
      const key = `${link.from}>${link.to}`;
      if (link.from === link.to || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, SCHEMA_MAX_LINKS);
}

export function extractSystemDesignSchema(answer: string): SystemDesignSchema | null {
  const sentences = sentencesOf(answer);
  const nodes = nodesOf(answer, sentences);
  if (nodes.length < 2) return null;
  const links = linksOf(sentences, new Set(nodes.map((node) => node.id)));
  return { nodes, links };
}
