/**
 * B803: отдельная цифра открытой аналитики (агентство, портал, СМИ, госданные) с источником,
 * ссылкой, годом и датой чтения. Цифры живут только в базе: репозиторий публичный.
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
    /** Период или вид цифры выведен по порядку величин, а не назван источником. */
    confidence: z.enum(['full', 'reduced']).default('full'),
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
  /** `false` убирает цифры источника из подбора; его срезы остаются. */
  enabled: z.boolean(),
});

/** Один срез источника: все его цифры на дату; `sourceName` и `sourceKind` цифры — его же. */
export const salarySliceSchema = z
  .strictObject({
    source: salaryBenchmarkSourceSchema,
    sliceDate: isoDate,
    benchmarks: z.array(salaryBenchmarkSchema).max(50_000),
  })
  .superRefine(({ source, benchmarks }, context) => {
    const fail = (message: string) => context.addIssue({ code: 'custom', message });
    if (new Set(benchmarks.map(({ id }) => id)).size !== benchmarks.length) fail('duplicate id');
    for (const row of benchmarks) {
      if (row.sourceName !== source.name || row.sourceKind !== source.kind)
        fail(`another source of ${row.id}`);
      if (usesRefusedHost(row.sourceUrl)) fail(`refused source of ${row.id}`);
    }
  });
export type SalarySlice = z.infer<typeof salarySliceSchema>;

const MIN_SAMPLE = 15;
/** Границы дальше друг от друга — это края выборки со сбоями («742–1 000 000»), а не вилка должности. */
const MAX_RANGE_RATIO = 5;

/** Отсев при загрузке: малая выборка не берётся, у неправдоподобных границ остаётся медиана. */
export function plausible(row: SalaryBenchmark): SalaryBenchmark[] {
  if (row.sampleSize !== null && row.sampleSize < MIN_SAMPLE) return [];
  if (row.low === null || row.high === null || row.high <= row.low * MAX_RANGE_RATIO) return [row];
  return row.median === null ? [] : [{ ...row, low: null, high: null }];
}
