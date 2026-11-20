import { describe, expect, it } from 'vitest';
import { extractSystemDesignSchema, mentionedNodeIds } from './systemDesignSchema';
import { applySchemaCorrections } from './systemDesignSchemaCorrection';

const ANSWER =
  'Требования: 2000 платежей в секунду. Клиент → шлюз API → сервис платежей. ' +
  'Сервис платежей пишет события в Kafka. Воркер читает события из очереди и кладёт итог в PostgreSQL. ' +
  'Метрики и алерты на ошибки.';

describe('B647: схема System Design из ответа', () => {
  it('returns null for an answer with fewer than two components', () => {
    expect(extractSystemDesignSchema('Сделаю всё надёжно.')).toBeNull();
    expect(extractSystemDesignSchema('Нужна база данных.')).toBeNull();
    expect(extractSystemDesignSchema('')).toBeNull();
  });

  it('extracts deduplicated components with stable ids and quotes', () => {
    const schema = extractSystemDesignSchema(ANSWER);
    expect(schema).not.toBeNull();
    const ids = schema!.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(schema!.nodes.map((node) => node.kind)).toEqual([
      'client',
      'gateway',
      'service',
      'queue',
      'worker',
      'database',
      'monitoring',
    ]);
    const queue = schema!.nodes.find((node) => node.kind === 'queue')!;
    expect(queue.label).toBe('Kafka');
    expect(queue.quote).toBe('Сервис платежей пишет события в Kafka.');
    expect(schema!.nodes.find((node) => node.kind === 'service')!.label).toBe('Сервис платежей');
    expect(schema!.nodes.find((node) => node.kind === 'database')!.label).toBe('PostgreSQL');
    expect(extractSystemDesignSchema(ANSWER)).toEqual(schema);
  });

  it('builds links from arrows, write and read verbs', () => {
    const schema = extractSystemDesignSchema(ANSWER)!;
    const pairs = schema.links.map((link) => `${link.from}>${link.to}`);
    const id = (kind: string) => schema.nodes.find((node) => node.kind === kind)!.id;
    expect(pairs).toEqual(
      expect.arrayContaining([
        `${id('client')}>${id('gateway')}`,
        `${id('gateway')}>${id('service')}`,
        `${id('service')}>${id('queue')}`,
        `${id('queue')}>${id('worker')}`,
        `${id('worker')}>${id('database')}`,
      ]),
    );
    for (const link of schema.links) expect(ANSWER).toContain(link.quote!);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('links «из X в Y» and sequential components after a flow verb', () => {
    const fromTo = extractSystemDesignSchema('Данные из кэша в базу данных.')!;
    expect(fromTo.links).toEqual([expect.objectContaining({ from: 'cache', to: 'database' })]);
    const flow = extractSystemDesignSchema('Запрос проходит балансировщик, gateway и Redis.')!;
    expect(flow.links.map((link) => `${link.from}>${link.to}`)).toEqual([
      'load_balancer>gateway',
      'gateway>cache',
    ]);
    const noFlow = extractSystemDesignSchema('Есть CDN. Есть S3.')!;
    expect(noFlow.links).toEqual([]);
  });

  it('finds node ids mentioned in a quote', () => {
    expect(mentionedNodeIds('Компоненты: API, очередь и база.')).toEqual([
      'gateway',
      'queue',
      'database',
    ]);
  });
});

describe('B647: «Исправить схему»', () => {
  const base = extractSystemDesignSchema(ANSWER)!;

  it('renames a node and removes a node with its links without mutating', () => {
    const snapshot = JSON.stringify(base);
    const result = applySchemaCorrections(base, [
      { op: 'rename_node', nodeId: 'queue', label: 'RabbitMQ' },
      { op: 'remove_node', nodeId: 'worker' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schema.nodes.find((node) => node.id === 'queue')!.label).toBe('RabbitMQ');
    expect(result.schema.nodes.some((node) => node.id === 'worker')).toBe(false);
    expect(result.schema.links.some((link) => link.from === 'worker' || link.to === 'worker')).toBe(
      false,
    );
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('adds and removes links', () => {
    const added = applySchemaCorrections(base, [
      { op: 'add_link', from: 'database', to: 'monitoring', label: 'метрики' },
      { op: 'remove_link', from: 'client', to: 'gateway' },
    ]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.schema.links).toContainEqual({
      from: 'database',
      to: 'monitoring',
      label: 'метрики',
      quote: null,
    });
    expect(added.schema.links.some((link) => link.from === 'client')).toBe(false);
  });

  it('rejects unknown ids, self links and duplicates', () => {
    expect(applySchemaCorrections(base, [{ op: 'remove_node', nodeId: 'nope' }])).toEqual({
      ok: false,
      error: 'unknown_node',
    });
    expect(applySchemaCorrections(base, [{ op: 'add_link', from: 'cdn', to: 'queue' }])).toEqual({
      ok: false,
      error: 'unknown_node',
    });
    expect(applySchemaCorrections(base, [{ op: 'add_link', from: 'queue', to: 'queue' }])).toEqual({
      ok: false,
      error: 'self_link',
    });
    expect(
      applySchemaCorrections(base, [{ op: 'add_link', from: 'client', to: 'gateway' }]),
    ).toEqual({ ok: false, error: 'duplicate_link' });
    expect(
      applySchemaCorrections(base, [{ op: 'remove_link', from: 'queue', to: 'client' }]),
    ).toEqual({ ok: false, error: 'unknown_link' });
  });
});
