import { describe, expect, it } from 'vitest';
import { rulesParse } from './rulesParse';
import { LEVEL_RANK } from '../levelMatcher';
import type { FunctionCode } from '../../../shared/roleTaxonomy';

describe('rulesParse (B267 S1)', () => {
  it('reads the level from an existing marker word', () => {
    expect(rulesParse('Chief Technology Officer').levelRank).toBe(LEVEL_RANK['c-level']);
    expect(rulesParse('Team Lead Backend').levelRank).toBe(LEVEL_RANK.lead);
    expect(rulesParse('Junior Developer').levelRank).toBe(LEVEL_RANK.ic);
  });

  it('returns levelRank null when the title names no level', () => {
    expect(rulesParse('Developer').levelRank).toBeNull();
  });

  it('prefers the more specific multi-word anchor', () => {
    // "vp of engineering" (eng-mgmt) должен победить общее "engineer" (eng).
    expect(rulesParse('VP of Engineering').functions).toEqual(['eng-mgmt']);
  });

  it('picks two functions for a dual-scope title', () => {
    const result = rulesParse('VP of Technology & Operations');
    expect(result.functions).toContain('eng-mgmt');
    expect(result.functions).toContain('ops');
    expect(result.functions.length).toBeLessThanOrEqual(2);
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
      if (!functions.includes(expected)) misses.push(`${title} -> ${functions.join(',')} (expected ${expected})`);
    }
    const accuracy = (GOLDEN_SET.length - misses.length) / GOLDEN_SET.length;
    expect(accuracy, `misses:\n${misses.join('\n')}`).toBeGreaterThanOrEqual(0.85);
  });
});
