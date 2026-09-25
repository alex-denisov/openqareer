import { describe, expect, it } from 'vitest';
import { rulesParse } from './rulesParse';
import { LEVEL_RANK } from '../levelMatcher';
import type { FunctionCode } from '../../../shared/roleTaxonomy';
import { ontology } from '../../../shared/roleOntology';

const ONTOLOGY_FUNCTION_VARIANTS = ontology.roles
  .slice()
  .sort(
    (left, right) => left.function.localeCompare(right.function) || left.id.localeCompare(right.id),
  )
  .reduce<readonly { readonly title: string; readonly function: string }[]>((samples, role) => {
    if (samples.some((sample) => sample.function === role.function) || samples.length === 30)
      return samples;
    const variants = [...role.variants.en, ...role.variants.ru];
    const title = variants[role.id.length % variants.length];
    return [...samples, { title, function: role.function }];
  }, []);

describe('rulesParse (B267 S1)', () => {
  it('uses exact ontology variants before anchor words', () => {
    expect(rulesParse('Врач КЛД')).toMatchObject({
      functions: ['healthcare'],
      levelRank: LEVEL_RANK.ic,
      roleId: 'healthcare.lab.ic',
    });
    expect(rulesParse('Торговый представитель')).toMatchObject({
      functions: ['sales'],
      levelRank: LEVEL_RANK.ic,
      roleId: 'sales.rep.ic',
    });
    expect(rulesParse('Key Account Manager')).toMatchObject({
      functions: ['sales'],
      levelRank: LEVEL_RANK.lead,
      roleId: 'sales.key-account-manager.lead',
    });
    expect(rulesParse('Главный врач')).toMatchObject({
      functions: ['healthcare'],
      levelRank: LEVEL_RANK['c-level'],
      roleId: 'healthcare.chief-physician.c',
    });
  });

  it('uses the longest multi-word ontology variant inside a title', () => {
    expect(rulesParse('Hiring: Key Account Manager in B2B')).toMatchObject({
      functions: ['sales'],
      roleId: 'sales.key-account-manager.lead',
    });
  });

  it('maps 30 deterministic ontology variants from different functions to their functions', () => {
    expect(ONTOLOGY_FUNCTION_VARIANTS).toHaveLength(30);
    for (const sample of ONTOLOGY_FUNCTION_VARIANTS) {
      expect(rulesParse(sample.title)).toMatchObject({
        functions: [sample.function],
      });
    }
  });

  // 0,4 мс на название: порция воркера из 500 названий — ~90 мс; более
  // жёсткий порог срывался под нагрузкой полного прогона.
  it('parses 5,000 titles within 2 s', () => {
    const titles = Array.from(
      { length: 5_000 },
      (_, index) =>
        `Open ${ONTOLOGY_FUNCTION_VARIANTS[index % ONTOLOGY_FUNCTION_VARIANTS.length].title} role`,
    );
    const startedAt = performance.now();
    titles.forEach((title) => rulesParse(title));
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });

  it('reads the level from an existing marker word', () => {
    expect(rulesParse('Chief Technology Officer').levelRank).toBe(LEVEL_RANK['c-level']);
    expect(rulesParse('Team Lead Backend').levelRank).toBe(LEVEL_RANK.lead);
    expect(rulesParse('Junior Developer').levelRank).toBe(LEVEL_RANK.ic);
  });

  // B267 S1: реальная выборка держала null-уровень у 68% строк, потому что
  // «нет явного маркера» читалось как «неизвестно». Обычный IC-заголовок без
  // слов уровня — это IC, а не пустой ответ (CPO-отчёт, Software Engineer).
  it('defaults to ic level when the title names no level marker', () => {
    expect(rulesParse('Developer').levelRank).toBe(LEVEL_RANK.ic);
    expect(rulesParse('Software Engineer').levelRank).toBe(LEVEL_RANK.ic);
    expect(rulesParse('Account Executive').levelRank).toBe(LEVEL_RANK.ic);
  });

  it('reads Director as head, not c-level, unless it is Senior Director or VP', () => {
    expect(rulesParse('Director, Demand Generation').levelRank).toBe(LEVEL_RANK.head);
    expect(rulesParse('Senior Director, Product Management').levelRank).toBe(LEVEL_RANK.vp);
    expect(rulesParse('VP of PMO').levelRank).toBe(LEVEL_RANK.vp);
  });

  it('reads CIO in parentheses as c-level even inside a RU director title', () => {
    expect(rulesParse('Директор по ИТ (CIO)').levelRank).toBe(LEVEL_RANK['c-level']);
  });

  it('prefers the more specific multi-word anchor', () => {
    // "vp of engineering" (eng-mgmt) должен победить общее "engineer" (eng).
    expect(rulesParse('VP of Engineering').functions).toEqual(['eng-mgmt']);
  });

  it('keeps both halves of a compound title with an exact ontology role', () => {
    // Кандидату «VP of Technology & Operations» нужно и ИТ-руководство, не только операции.
    const result = rulesParse('VP of Technology & Operations');
    expect(result).toMatchObject({ roleId: 'ops.vp' });
    expect(result.functions).toEqual(expect.arrayContaining(['ops', 'eng-mgmt']));
  });

  it('does not confuse VP Channel Sales with engineering management', () => {
    expect(rulesParse('VP Channel Sales').functions).toEqual(['sales']);
  });

  it('reads Head of Growth as marketing', () => {
    expect(rulesParse('Head of Growth').functions).toContain('marketing');
  });

  // Золотой набор ~150 названий (B267 S1): доля верных функций ≥ 85%.
  const GOLDEN_SET: readonly [string, FunctionCode][] = [
    ['CTO', 'eng-mgmt'],
    ['Chief Technology Officer', 'eng-mgmt'],
    ['CIO', 'it-ops'],
    ['Chief Information Officer', 'it-ops'],
    ['CEO', 'exec-general'],
    ['Chief Executive Officer', 'exec-general'],
    ['COO', 'ops'],
    ['Chief Operating Officer', 'ops'],
    ['CFO', 'finance'],
    ['Chief Financial Officer', 'finance'],
    ['CMO', 'marketing'],
    ['Chief Marketing Officer', 'marketing'],
    ['CPO', 'product'],
    ['VP Eng', 'eng-mgmt'],
    ['VP Engineering', 'eng-mgmt'],
    ['VP of Engineering', 'eng-mgmt'],
    ['VP Technology', 'eng-mgmt'],
    ['VP of Technology', 'eng-mgmt'],
    ['VP Channel Sales', 'sales'],
    ['VP of Sales', 'sales'],
    ['VP Sales', 'sales'],
    ['Head of Growth', 'marketing'],
    ['Head of Engineering', 'eng-mgmt'],
    ['Head of Technology', 'eng-mgmt'],
    ['Технический директор', 'eng-mgmt'],
    ['Директор по технологиям', 'eng-mgmt'],
    ['Руководитель ИТ-инфраструктуры', 'it-ops'],
    ['ИТ-директор', 'it-ops'],
    ['Системный администратор', 'it-ops'],
    ['System Administrator', 'it-ops'],
    ['DevOps Engineer', 'it-ops'],
    ['Network Engineer', 'it-ops'],
    ['C++ developer', 'eng'],
    ['Software Engineer', 'eng'],
    ['Senior Software Engineer', 'eng'],
    ['Backend Developer', 'eng'],
    ['Frontend Developer', 'eng'],
    ['Full Stack Developer', 'eng'],
    ['Разработчик', 'eng'],
    ['Программист', 'eng'],
    ['Ведущий программист', 'eng'],
    ['Data Engineer', 'data'],
    ['Data Analyst', 'data'],
    ['Аналитик данных', 'data'],
    ['Machine Learning Engineer', 'ai-ml'],
    ['ML Engineer', 'ai-ml'],
    ['Data Scientist', 'ai-ml'],
    ['Специалист по искусственному интеллекту', 'ai-ml'],
    ['Security Engineer', 'security'],
    ['Cybersecurity Analyst', 'security'],
    ['Специалист по безопасности', 'security'],
    ['QA Engineer', 'qa'],
    ['Test Automation Engineer', 'qa'],
    ['Тестировщик', 'qa'],
    ['Инженер по тестированию', 'qa'],
    ['Product Manager', 'product'],
    ['Senior Product Manager', 'product'],
    ['Product Owner', 'product'],
    ['Продакт-менеджер', 'product'],
    ['Менеджер продукта', 'product'],
    ['UX Designer', 'design'],
    ['UI Designer', 'design'],
    ['Product Designer', 'design'],
    ['Дизайнер', 'design'],
    ['Графический дизайнер', 'design'],
    ['Operations Manager', 'ops'],
    ['Business Operations Manager', 'ops'],
    ['Операционный директор', 'ops'],
    ['Руководитель операционного отдела', 'ops'],
    ['Sales Manager', 'sales'],
    ['Sales Director', 'sales'],
    ['Account Executive', 'sales'],
    ['Менеджер по продажам', 'sales'],
    ['Руководитель отдела продаж', 'sales'],
    ['Директор по продажам', 'sales'],
    ['Business Development Manager', 'bizdev'],
    ['Partnerships Manager', 'bizdev'],
    ['Менеджер по развитию бизнеса', 'bizdev'],
    ['Marketing Manager', 'marketing'],
    ['Marketing Director', 'marketing'],
    ['Growth Marketing Manager', 'marketing'],
    ['Маркетолог', 'marketing'],
    ['Директор по маркетингу', 'marketing'],
    ['PR Manager', 'pr'],
    ['Public Relations Manager', 'pr'],
    ['Пиар-менеджер', 'pr'],
    ['Customer Support Specialist', 'support'],
    ['Technical Support Engineer', 'support'],
    ['Специалист поддержки', 'support'],
    ['Служба поддержки', 'support'],
    ['Financial Analyst', 'finance'],
    ['Finance Manager', 'finance'],
    ['Финансовый директор', 'finance'],
    ['Финансовый аналитик', 'finance'],
    ['Бухгалтер', 'finance'],
    ['Экономист', 'finance'],
    ['Internal Audit Manager', 'audit-risk'],
    ['Risk Manager', 'audit-risk'],
    ['Compliance Officer', 'audit-risk'],
    ['Аудитор', 'audit-risk'],
    ['Риск-менеджер', 'audit-risk'],
    ['HR Manager', 'hr'],
    ['HR Business Partner', 'hr'],
    ['Recruiter', 'hr'],
    ['Менеджер по персоналу', 'hr'],
    ['Рекрутер', 'hr'],
    ['Legal Counsel', 'legal'],
    ['Lawyer', 'legal'],
    ['Юрист', 'legal'],
    ['Юрисконсульт', 'legal'],
    ['Procurement Manager', 'procurement'],
    ['Purchasing Manager', 'procurement'],
    ['Менеджер по закупкам', 'procurement'],
    ['Logistics Manager', 'logistics'],
    ['Supply Chain Manager', 'logistics'],
    ['Логист', 'logistics'],
    ['Production Manager', 'manufacturing'],
    ['Manufacturing Engineer', 'manufacturing'],
    ['Технолог', 'manufacturing'],
    ['Store Manager', 'retail'],
    ['Retail Manager', 'retail'],
    ['Директор магазина', 'retail'],
    ['Продавец-консультант', 'retail'],
    ['Hotel Manager', 'hospitality'],
    ['Chef', 'hospitality'],
    ['Повар', 'hospitality'],
    ['Официант', 'hospitality'],
    ['Agronomist', 'agriculture'],
    ['Агроном', 'agriculture'],
    ['Doctor', 'healthcare'],
    ['Врач', 'healthcare'],
    ['Медсестра', 'healthcare'],
    ['Teacher', 'education'],
    ['Преподаватель', 'education'],
    ['Учитель', 'education'],
    ['Management Consultant', 'consulting'],
    ['Консультант', 'consulting'],
    ['Project Manager', 'project-mgmt'],
    ['Program Manager', 'project-mgmt'],
    ['Scrum Master', 'project-mgmt'],
    ['Менеджер проектов', 'project-mgmt'],
    ['Руководитель проекта', 'project-mgmt'],
    ['Research Scientist', 'research'],
    ['Научный сотрудник', 'research'],
    ['General Manager', 'exec-general'],
    ['Генеральный директор', 'exec-general'],
    ['Office Manager', 'admin'],
    ['Administrative Assistant', 'admin'],
    ['Офис-менеджер', 'admin'],
    ['Real Estate Agent', 'real-estate'],
    ['Риэлтор', 'real-estate'],
    ['Civil Engineer', 'construction'],
    ['Construction Manager', 'construction'],
    ['Прораб', 'construction'],
    ['Content Producer', 'media'],
    ['Video Editor', 'media'],
    ['Журналист', 'media'],
  ];

  it(`classifies at least 85% of the ${GOLDEN_SET.length} golden titles correctly`, () => {
    const misses: string[] = [];
    for (const [title, expected] of GOLDEN_SET) {
      const { functions } = rulesParse(title);
      if (!functions.includes(expected))
        misses.push(`${title} -> ${functions.join(',')} (expected ${expected})`);
    }
    const accuracy = (GOLDEN_SET.length - misses.length) / GOLDEN_SET.length;
    expect(accuracy, `misses:\n${misses.join('\n')}`).toBeGreaterThanOrEqual(0.85);
  });
});
