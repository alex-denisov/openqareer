/**
 * B803: отдельная цифра открытой аналитики (агентство, портал, СМИ, госданные) с источником,
 * ссылкой, годом и датой чтения. Файл с цифрами лежит рядом с базой на хосте, не в репозитории:
 * репозиторий публичный, а цифры наружу не отдаются — только кандидату в кабинете.
 */
import { z } from 'zod';

export const BENCHMARK_SOURCE_KINDS = ['agency', 'portal', 'media', 'gov'] as const;
export type BenchmarkSourceKind = (typeof BENCHMARK_SOURCE_KINDS)[number];

const name = z.string().trim().min(1).max(200);
const amount = z.number().positive().finite().nullable();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'not a date');

export const salaryBenchmarkSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,120}$/u),
    sourceKind: z.enum(BENCHMARK_SOURCE_KINDS),
    sourceName: name,
    sourceUrl: z.url({ protocol: /^https$/u }).max(1000),
    role: name,
    roleAliases: z.array(name).max(40).default([]),
    functionCode: z.string().min(1).max(60).nullable(),
    levelRank: z.number().int().min(0).max(4).nullable(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/u)
      .nullable(),
    region: z.enum(['us', 'eu', 'ru', 'cis', 'mena', 'apac', 'latam']).nullable(),
    city: name.nullable(),
    low: amount,
    median: amount,
    high: amount,
    currency: z.string().regex(/^[A-Z]{3}$/u),
    period: z.enum(['hour', 'day', 'month', 'year']),
    tax: z.enum(['gross', 'net', 'unknown']),
    /** Оклад или полный доход с премией; источник не сказал — `unknown`. */
    payBase: z.enum(['base', 'total', 'unknown']).default('unknown'),
    year: z.number().int().min(2015).max(2100),
    sampleSize: z.number().int().positive().nullable(),
    readOn: isoDate,
  })
  .refine((row) => (row.country === null) !== (row.region === null), 'country or region, not both')
  .refine((row) => row.city === null || row.country !== null, 'city needs a country')
  .refine((row) => (row.low === null) === (row.high === null), 'low and high come together')
  .refine((row) => row.median !== null || row.low !== null, 'low and high, or median')
  .refine(
    (row) => row.low === null || row.high === null || row.low <= row.high,
    'low is above high',
  )
  .refine(
    (row) =>
      row.median === null ||
      ((row.low ?? row.median) <= row.median && row.median <= (row.high ?? row.median)),
    'median is outside the range',
  );

export type SalaryBenchmark = z.infer<typeof salaryBenchmarkSchema>;

/** Источники, которыми не пользуемся. */
const REFUSED_HOSTS = /(?:^|\.)glassdoor\.[a-z.]+$/u;

const usesRefusedHost = (url: string) => REFUSED_HOSTS.test(new URL(url).hostname);

export const salaryBenchmarkSourceSchema = z.strictObject({
  name,
  kind: z.enum(BENCHMARK_SOURCE_KINDS),
  /** `false` убирает все цифры источника при следующей загрузке. */
  enabled: z.boolean(),
});

/** Файл: список источников и цифры; `sourceName` и `sourceKind` цифры — из списка. */
export const salaryBenchmarksFileSchema = z
  .strictObject({
    sources: z.array(salaryBenchmarkSourceSchema).max(500),
    benchmarks: z.array(salaryBenchmarkSchema).max(50_000),
  })
  .superRefine(({ sources, benchmarks }, context) => {
    const fail = (message: string) => context.addIssue({ code: 'custom', message });
    const kinds = new Map(sources.map(({ name: source, kind }) => [source, kind]));
    if (kinds.size !== sources.length) fail('duplicate source');
    if (new Set(benchmarks.map(({ id }) => id)).size !== benchmarks.length) fail('duplicate id');
    for (const row of benchmarks) {
      if (kinds.get(row.sourceName) !== row.sourceKind) fail(`unknown source of ${row.id}`);
      if (usesRefusedHost(row.sourceUrl)) fail(`refused source of ${row.id}`);
    }
  });

const MIN_SAMPLE = 15;
/** Границы дальше друг от друга — это края выборки со сбоями («742–1 000 000»), а не вилка должности. */
const MAX_RANGE_RATIO = 5;

/** Отсев при загрузке: малая выборка не берётся, у неправдоподобных границ остаётся медиана. */
function plausible(row: SalaryBenchmark): SalaryBenchmark[] {
  if (row.sampleSize !== null && row.sampleSize < MIN_SAMPLE) return [];
  if (row.low === null || row.high === null || row.high <= row.low * MAX_RANGE_RATIO) return [row];
  return row.median === null ? [] : [{ ...row, low: null, high: null }];
}

export function enabledBenchmarks(
  file: z.infer<typeof salaryBenchmarksFileSchema>,
): SalaryBenchmark[] {
  const enabled = new Set(file.sources.filter((row) => row.enabled).map((row) => row.name));
  return file.benchmarks.filter((row) => enabled.has(row.sourceName)).flatMap(plausible);
}
