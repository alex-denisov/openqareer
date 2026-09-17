import { describe, expect, it } from 'vitest';
import {
  checkCrossSourceConsistency,
  classifyReputationRisks,
  calculateReputationScore,
  performCandidateReputationAudit,
  type CandidateExperienceItem,
  type ExternalSourceProfile,
  type PublicPostItem,
} from './candidateReputationService';

describe('candidateReputationService', () => {
  describe('checkCrossSourceConsistency', () => {
    it('возвращает пустой список расхождений при полной согласованности', () => {
      const candidateExp: CandidateExperienceItem[] = [
        {
          id: 'exp-1',
          company: 'Яндекс',
          role: 'Старший разработчик',
          startDate: '2021-01',
          endDate: '2023-01',
        },
      ];
      const external: ExternalSourceProfile[] = [
        {
          platform: 'hh.ru',
          company: 'Яндекс',
          role: 'Старший разработчик',
          startDate: '2021-01',
          endDate: '2023-01',
        },
      ];

      const discrepancies = checkCrossSourceConsistency(candidateExp, external);
      expect(discrepancies).toEqual([]);
    });

    it('выявляет несовпадение дат между резюме и внешним источником более 6 месяцев', () => {
      const candidateExp: CandidateExperienceItem[] = [
        {
          id: 'exp-1',
          company: 'Сбер',
          role: 'Product Manager',
          startDate: '2020-01',
          endDate: '2022-12',
        },
      ];
      const external: ExternalSourceProfile[] = [
        {
          platform: 'Хабр Карьера',
          company: 'Сбер',
          role: 'Product Manager',
          startDate: '2020-01',
          endDate: '2021-06',
        },
      ];

      const discrepancies = checkCrossSourceConsistency(candidateExp, external);
      expect(discrepancies.length).toBeGreaterThanOrEqual(1);
      const dateDisc = discrepancies.find((d) => d.field.includes('Дата'));
      expect(dateDisc).toBeDefined();
      expect(dateDisc?.externalSource).toBe('Хабр Карьера');
      expect(dateDisc?.severity).toBe('warning');
    });

    it('выявляет несовпадение грейда или должности', () => {
      const candidateExp: CandidateExperienceItem[] = [
        {
          id: 'exp-1',
          company: 'VK',
          role: 'Lead Data Scientist',
          startDate: '2022-01',
          endDate: '2023-01',
        },
      ];
      const external: ExternalSourceProfile[] = [
        {
          platform: 'LinkedIn',
          company: 'VK',
          role: 'Junior Data Scientist',
          startDate: '2022-01',
          endDate: '2023-01',
        },
      ];

      const discrepancies = checkCrossSourceConsistency(candidateExp, external);
      const roleDisc = discrepancies.find((d) => d.field.includes('Должность'));
      expect(roleDisc).toBeDefined();
      expect(roleDisc?.severity).toBe('critical');
    });

    it('обнаруживает скрытый разрыв в карьерной истории более 6 месяцев', () => {
      const candidateExp: CandidateExperienceItem[] = [
        {
          id: 'exp-1',
          company: 'Alpha Inc',
          role: 'Developer',
          startDate: '2020-01',
          endDate: '2020-12',
        },
        {
          id: 'exp-2',
          company: 'Beta Corp',
          role: 'Developer',
          startDate: '2022-01',
          endDate: '2023-01',
        },
      ];

      const discrepancies = checkCrossSourceConsistency(candidateExp, []);
      const gapDisc = discrepancies.find((d) => d.field.includes('Разрыв'));
      expect(gapDisc).toBeDefined();
      expect(gapDisc?.severity).toBe('warning');
    });

    it('обнаруживает наложение параллельных ролей без явной отметки', () => {
      const candidateExp: CandidateExperienceItem[] = [
        {
          id: 'exp-1',
          company: 'First Corp',
          role: 'Full-time Engineer',
          startDate: '2021-01',
          endDate: '2022-06',
        },
        {
          id: 'exp-2',
          company: 'Second Corp',
          role: 'Full-time Architect',
          startDate: '2021-06',
          endDate: '2022-12',
        },
      ];

      const discrepancies = checkCrossSourceConsistency(candidateExp, []);
      const overlapDisc = discrepancies.find((d) => d.field.includes('Параллельная'));
      expect(overlapDisc).toBeDefined();
    });
  });

  describe('classifyReputationRisks', () => {
    it('детектирует токсичные высказывания о работодателях', () => {
      const posts: PublicPostItem[] = [
        {
          id: 'p-1',
          sourcePlatform: 'Habr',
          sourceUrl: 'https://habr.com/p/123',
          publishedAt: '2023-04-01',
          content: 'Бывшее руководство — кидалы и самодуры, никому не советую эту шарашкину контору',
        },
      ];

      const risks = classifyReputationRisks(posts);
      expect(risks).toHaveLength(1);
      expect(risks[0].category).toBe('toxic_workplace');
      expect(risks[0].severity).toBe('high');
      expect(risks[0].remediation).toContain('Удалить');
    });

    it('детектирует разглашение конфиденциальных данных и NDA', () => {
      const posts: PublicPostItem[] = [
        {
          id: 'p-2',
          sourcePlatform: 'Telegram',
          publishedAt: '2023-08-15',
          content: 'Вот слив метрик и скриншоты внутренних финансовых дашбордов под NDA компании',
        },
      ];

      const risks = classifyReputationRisks(posts);
      expect(risks).toHaveLength(1);
      expect(risks[0].category).toBe('nda_leak');
      expect(risks[0].severity).toBe('high');
    });

    it('детектирует конфликтные поляризованные споры', () => {
      const posts: PublicPostItem[] = [
        {
          id: 'p-3',
          sourcePlatform: 'Twitter',
          publishedAt: '2023-02-10',
          content: 'Вы все идиоты и уроды, чтобы вы все сдохли в своих нищих офисах',
        },
      ];

      const risks = classifyReputationRisks(posts);
      expect(risks).toHaveLength(1);
      expect(risks[0].category).toBe('polarizing_argument');
      expect(risks[0].severity).toBe('medium');
    });

    it('детектирует комплаенс-конфликты', () => {
      const posts: PublicPostItem[] = [
        {
          id: 'p-4',
          sourcePlatform: 'VC.ru',
          publishedAt: '2023-09-01',
          content: 'Как мы брали откат и вели работу на конкурента втайне от службы безопасности',
        },
      ];

      const risks = classifyReputationRisks(posts);
      expect(risks).toHaveLength(1);
      expect(risks[0].category).toBe('compliance_conflict');
      expect(risks[0].severity).toBe('high');
    });

    it('игнорирует нейтральные и профессиональные публикации', () => {
      const posts: PublicPostItem[] = [
        {
          id: 'p-5',
          sourcePlatform: 'Medium',
          publishedAt: '2023-05-20',
          content: 'Архитектурный паттерн CQRS в распределенных системах: плюсы и минусы',
        },
      ];

      const risks = classifyReputationRisks(posts);
      expect(risks).toHaveLength(0);
    });
  });

  describe('calculateReputationScore', () => {
    it('присваивает 100 и safe при отсутствии рисков и расхождений', () => {
      const { score, overallStatus } = calculateReputationScore([], []);
      expect(score).toBe(100);
      expect(overallStatus).toBe('safe');
    });

    it('присваивает attention при умеренных предупреждениях', () => {
      const { score, overallStatus } = calculateReputationScore(
        [
          {
            id: 'd1',
            field: 'Дата окончания',
            candidateValue: '2022',
            externalValue: '2021',
            externalSource: 'hh.ru',
            severity: 'warning',
            suggestion: 'Уточнить дату',
          },
        ],
        [],
      );
      expect(score).toBeLessThan(100);
      expect(score).toBeGreaterThanOrEqual(60);
      expect(overallStatus).toBe('attention');
    });

    it('присваивает critical_risk при наличии высокого риска утечки NDA', () => {
      const { overallStatus } = calculateReputationScore(
        [],
        [
          {
            id: 'r1',
            sourcePlatform: 'Telegram',
            excerpt: 'Слив метрик',
            category: 'nda_leak',
            severity: 'high',
            remediation: 'Удалить',
          },
        ],
      );
      expect(overallStatus).toBe('critical_risk');
    });
  });

  describe('performCandidateReputationAudit', () => {
    it('формирует полноценный аудит с фиксацией согласия 152-ФЗ / GDPR', () => {
      const audit = performCandidateReputationAudit({
        candidateId: 'cand-777',
        experience: [
          {
            id: 'exp-1',
            company: 'Tech Corp',
            role: 'Lead Architect',
            startDate: '2022-01',
            endDate: '2024-01',
          },
        ],
        externalProfiles: [],
        publicPosts: [],
      });

      expect(audit.candidateId).toBe('cand-777');
      expect(audit.status).toBe('completed');
      expect(audit.overallStatus).toBe('safe');
      expect(audit.score).toBe(100);
      expect(audit.consentAction).toBe(
        'Запуск аудита цифрового следа по инициативе кандидата согласно 152-ФЗ / GDPR',
      );
      expect(audit.startedAt).toBeDefined();
      expect(audit.completedAt).toBeDefined();
    });
  });
});
