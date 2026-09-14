import { describe, expect, it, vi } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';

/**
 * Прод 2026-09-06: пул вырос с 1867 до 4836 вакансий (доски работодателей,
 * B202), и запуск процесса стал занимать 45 секунд вместо семи — сведение
 * разбирало строки заново на каждое сравнение. Выкат не успевал ответить на
 * проверку здоровья и откатывался: продукт стало нельзя выпускать.
 *
 * ПОЧЕМУ СЧЁТЧИК, А НЕ СЕКУНДОМЕР (PRB-021). Первая версия сторожа сравнивала
 * настенное время с порогом 5 с. Под `npm run test:coverage` инструментирование
 * v8 замедляло прогон до 8187 мс, и собственный гейт покрытия репозитория
 * краснел без единого регресса в коде. Секундомер мерил машину и условия
 * замера, а не то, что сломалось.
 *
 * Сломалось же именно число разборов записи: подготовка уехала внутрь
 * сравнения, и `normalizeTextForComparison` вызывался квадратично вместо
 * линейного. Счётчик вызовов детерминирован — одинаков на любой машине, под
 * любым инструментированием и в любой нагрузке.
 */
const counter = vi.hoisted(() => ({ calls: 0 }));

vi.mock('./vacancyFingerprint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./vacancyFingerprint')>();
  return {
    ...actual,
    normalizeTextForComparison: (text: string) => {
      counter.calls += 1;
      return actual.normalizeTextForComparison(text);
    },
  };
});

const { clusterVacancies } = await import('./vacancyDeduplicator');

function vacancy(index: number): UnifiedVacancy {
  const roles = ['Senior Backend Engineer', 'Product Manager', 'Data Scientist', 'DevOps Engineer'];
  return {
    id: `board-${index % 180}:${index}`,
    fingerprint: `board-${index % 180}:${index}`,
    title: `${roles[index % roles.length]}, ${['Berlin', 'London', 'Remote EU'][index % 3]} #${index}`,
    company: `Company ${Math.floor(index / 2)}`,
    location: 'Berlin, Germany',
    description: 'We are looking for an engineer. '.repeat(20),
    requiredSkills: ['React'],
    url: `https://boards.example.com/c${index % 180}/${index}`,
    provenance: {
      sourceType: 'json_api',
      sourceId: `board-${index % 180}`,
      sourceUrl: `https://boards.example.com/c${index % 180}/${index}`,
      observedAt: '2026-09-06T00:00:00.000Z',
    },
    publishedAt: '2026-09-06T00:00:00.000Z',
    status: 'active',
  };
}

/**
 * Разбор одной записи трогает строки постоянное число раз (название,
 * работодатель, ссылка), и каждая запись разбирается дважды: как кандидат и
 * как представитель своего кластера. Потолок взят с большим запасом на эту
 * постоянную — он ловит возврат разбора в цикл сравнения, а не изменение
 * состава полей.
 */
const PARSES_PER_RECORD = 12;

/**
 * Свой потолок времени у прогона всё-таки нужен — но как защита от зависания,
 * а не как мерило стоимости. Под инструментированием покрытия сведение пула
 * размером с прод честно не укладывается в общие 5 секунд vitest, и падение по
 * общему потолку было бы тем же секундомером с другого конца (PRB-021).
 */
const NO_HANG_TIMEOUT_MS = 120_000;

describe('стоимость сведения пула', () => {
  it('разбирает запись постоянное число раз, а не заново на каждое сравнение', () => {
    const size = 4836;
    const pool = Array.from({ length: size }, (_, index) => vacancy(index));

    counter.calls = 0;
    const clusters = clusterVacancies(pool);
    const parses = counter.calls;

    expect(clusters.length).toBeGreaterThan(1000);
    // Квадратичный разбор дал бы миллионы вызовов на этом же пуле.
    expect(parses).toBeLessThan(size * PARSES_PER_RECORD);
  }, NO_HANG_TIMEOUT_MS);

  it('удвоение пула удваивает разбор, а не возводит его в квадрат', () => {
    const small = Array.from({ length: 600 }, (_, index) => vacancy(index));
    const large = Array.from({ length: 1200 }, (_, index) => vacancy(index));

    counter.calls = 0;
    clusterVacancies(small);
    const smallParses = counter.calls;

    counter.calls = 0;
    clusterVacancies(large);
    const largeParses = counter.calls;

    // Линейный рост даёт ~2×; квадратичный дал бы ~4× и выше.
    expect(largeParses / smallParses).toBeLessThan(2.5);
  }, NO_HANG_TIMEOUT_MS);
});

/**
 * B216 — сведение 42 460 записей прода занимало 203 секунды: каждая запись
 * сравнивалась с каждым кластером. Индекс кандидатов держит стоимость близкой
 * к линейной; на 20 000 записей без дублей квадратичный обход занимал ~15 с.
 */
describe('clustering scales with an index, not a full scan (B216)', () => {
  it('сводит 20 000 несовпадающих записей за секунды, а не за десятки секунд', () => {
    const vacancies: UnifiedVacancy[] = Array.from({ length: 20_000 }, (_, i) => ({
      id: `v-${i}`,
      fingerprint: `fp-${i}`,
      title: `Engineer ${i % 97} level ${i % 13}`,
      company: `Firm${i}z`,
      description: 'x',
      requiredSkills: [],
      url: `https://example.com/jobs/${i}`,
      provenance: {
        sourceType: 'json_api',
        sourceId: `src-${i % 5}`,
        sourceUrl: `https://example.com/jobs/${i}`,
        observedAt: '2026-09-14T00:00:00.000Z',
      },
      publishedAt: '2026-09-14T00:00:00.000Z',
      status: 'active',
    }));

    const started = performance.now();
    const clusters = clusterVacancies(vacancies);
    const seconds = (performance.now() - started) / 1000;

    expect(clusters).toHaveLength(20_000);
    expect(seconds).toBeLessThan(4);
  });
});
