import { describe, expect, it } from 'vitest';
import { clusterVacancies } from './vacancyDeduplicator';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';

/**
 * Прод 2026-09-06: пул вырос с 1867 до 4836 вакансий (доски работодателей,
 * B202), и запуск процесса стал занимать 45 секунд вместо семи — сведение
 * разбирало строки заново на каждое сравнение. Выкат не успевал ответить на
 * проверку здоровья и откатывался: продукт стало нельзя выпускать.
 *
 * Тест держит стоимость на месте. Порог намеренно щедрый: он ловит возврат
 * квадратичного разбора (было 14 с на этой же машине), а не колебания в разы.
 */
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

describe('стоимость сведения пула', () => {
  it('пул размером с прод сводится за считанные секунды, а не за минуту', () => {
    const pool = Array.from({ length: 4836 }, (_, index) => vacancy(index));

    const started = Date.now();
    const clusters = clusterVacancies(pool);
    const elapsedMs = Date.now() - started;

    expect(clusters.length).toBeGreaterThan(1000);
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
