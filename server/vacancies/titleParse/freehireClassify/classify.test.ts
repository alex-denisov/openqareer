import { describe, expect, it } from 'vitest';
import { freehireCategory, freehireItFunction, isConfirmedNonItTitle } from './classify';

/**
 * Real titles from freehire's classify_*_test.go fixtures (MIT, Copyright (c) 2026
 * freehire contributors); expected values are what freehire's Go Parse returns.
 */
const GOLDEN: readonly (readonly [string, string])[] = [
  // Russian (classify_test.go)
  ['Рекрутер', 'recruiting'],
  ['Менеджер по персоналу', 'hr'],
  ['Главный бухгалтер', 'finance'],
  ['Юрисконсульт', 'legal'],
  ['Специалист по закупкам', 'operations'],
  ['Системный аналитик', 'business_analysis'],
  ['Пресейл-инженер', 'solutions_engineering'],
  ['Технический писатель', 'technical_writing'],
  ['Старший backend-разработчик', 'backend'],
  ['Младший фронтенд разработчик', 'frontend'],
  ['Ведущий инженер DevOps', 'devops'],
  ['Аналитик данных', 'data_analytics'],
  ['Тестировщик ПО', 'qa'],
  ['Дизайнер интерфейсов', 'design'],
  ['Мобильный разработчик', 'mobile'],
  ['Инженер по информационной безопасности', 'security'],
  ['Специалист по продажам', 'sales'],
  ['Специалист технической поддержки', 'it_support'],
  ['Системный архитектор', 'architecture'],
  ['Сетевой инженер', 'network_engineering'],
  ['Скрам-мастер', 'project_management'],
  // Ukrainian / Bulgarian (classify_cee_test.go)
  ['Фахівець IT підтримки', 'it_support'],
  ['Системний адміністратор', 'devops'],
  ['Тест Інженер', 'qa'],
  // Japanese: CJK boundary rule (classify_ja_test.go)
  ['ITサポートエンジニア', 'it_support'],
  ['機械学習エンジニア (ML/NLP)', 'ml_ai'],
  ['【CL】SREエンジニア（オブザーバビリティ）', 'sre'],
  ['インフラエンジニア（ハードウェア担当）', 'devops'],
  ['サービスエンジニア・サポートエンジニア（工作機械・ロボット・機械系）', 'support'],
  // Back-end shift cut (classify_safety_consumer / service tests)
  ['Registered Nurse (RN) - Back End Days', 'healthcare'],
  ['Direct Support Professional Back End (Night)-Entry Level', 'social_services'],
  ['Machine Operator - Back End Relief - 12 hour nights (6pm-6:30am)', 'manufacturing'],
  ['Lab Technician 3 (Chemistry) Back End Days', 'science'],
  // categoryNone sentinel and the design crafts (classify_design_test.go)
  ['Software Design Engineer', ''],
  ['Mechanical Design Engineer', 'engineering_design'],
  ['Civil Design Engineer', 'engineering_design'],
  // German compound heads (classify_de_test.go)
  ['Verkäufer (m/w/d)', 'retail'],
  ['Fachverkäufer Bäckerei (m/w/d)', 'retail'],
  ['Kassierer (m/w/d)', 'retail'],
  // Spanish gender fold (classify_es_test.go)
  ['Desarrollador/a de Software', 'software_engineering'],
  ['Promovendedor/a Córdoba', 'sales'],
  ['Auxiliar de Enfermería / Gerocultor/a', 'healthcare'],
];

describe('freehireCategory (port of freehire classify.Parse, category only)', () => {
  it.each(GOLDEN)('%s → %s', (title, expected) => {
    expect(freehireCategory(title)).toBe(expected);
  });

  it('keeps "Backend Developer - Night Shift" a backend title', () => {
    expect(freehireCategory('Backend Developer - Night Shift')).toBe('backend');
  });

  it('needs a whole word for a Latin alias', () => {
    expect(freehireCategory('presreエンジニア')).not.toBe('sre');
  });

  it('returns "" for an empty title', () => {
    expect(freehireCategory('')).toBe('');
  });
});

describe('freehireItFunction', () => {
  it.each([
    ['Старший backend-разработчик', 'eng'],
    ['Мобильный разработчик', 'eng'],
    ['Системный архитектор', 'eng'],
    ['Аналитик данных', 'data'],
    ['機械学習エンジニア (ML/NLP)', 'ai-ml'],
    ['Инженер по информационной безопасности', 'security'],
    ['Тестировщик ПО', 'qa'],
    ['Дизайнер интерфейсов', 'design'],
    ['Ведущий инженер DevOps', 'it-ops'],
    ['Сетевой инженер', 'it-ops'],
    ['Специалист технической поддержки', 'it-ops'],
  ] as const)('%s → %s', (title, expected) => {
    expect(freehireItFunction(title)).toBe(expected);
  });

  it.each(['Рекрутер', 'Главный бухгалтер', 'Software Design Engineer', 'Технический писатель'])(
    '%s → null',
    (title) => {
      expect(freehireItFunction(title)).toBeNull();
    },
  );
});

describe('isConfirmedNonItTitle', () => {
  it.each([
    'Рекрутер',
    'Главный бухгалтер',
    'Kassierer (m/w/d)',
    'Registered Nurse (RN) - Back End Days',
  ])('%s is confirmed non-IT', (title) => {
    expect(isConfirmedNonItTitle(title)).toBe(true);
  });

  it.each([
    'Старший backend-разработчик',
    'Software Design Engineer',
    'Технический писатель',
    'Пресейл-инженер',
    'Скрам-мастер',
    'Совсем непонятное название',
  ])('%s is not confirmed non-IT', (title) => {
    expect(isConfirmedNonItTitle(title)).toBe(false);
  });
});
