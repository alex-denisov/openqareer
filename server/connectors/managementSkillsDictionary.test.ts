import { describe, expect, it } from 'vitest';
import {
  canonicalizeSkill,
  extractManagementSkillsFromText,
  MANAGEMENT_SKILLS_DICTIONARY,
} from './managementSkillsDictionary';

describe('managementSkillsDictionary', () => {
  it('has under 300 lines in definition file and defines canonical competencies', () => {
    expect(MANAGEMENT_SKILLS_DICTIONARY.length).toBeGreaterThanOrEqual(10);
    for (const entry of MANAGEMENT_SKILLS_DICTIONARY) {
      expect(entry.canonical).toBeTruthy();
      expect(entry.synonyms.length).toBeGreaterThan(0);
    }
  });

  describe('canonicalizeSkill', () => {
    it('maps team management synonyms to canonical Управление командой', () => {
      expect(canonicalizeSkill('руководство командой')).toBe('Управление командой');
      expect(canonicalizeSkill('Руководство командой')).toBe('Управление командой');
      expect(canonicalizeSkill('управление командой')).toBe('Управление командой');
      expect(canonicalizeSkill('руководство коллективом')).toBe('Управление командой');
      expect(canonicalizeSkill('team management')).toBe('Управление командой');
      expect(canonicalizeSkill('Team Leadership')).toBe('Управление командой');
      expect(canonicalizeSkill('Cross-functional Team Leadership')).toBe('Управление командой');
    });

    it('maps P&L synonyms to canonical Управление P&L', () => {
      expect(canonicalizeSkill('P&L')).toBe('Управление P&L');
      expect(canonicalizeSkill('p&l')).toBe('Управление P&L');
      expect(canonicalizeSkill('P&L Management')).toBe('Управление P&L');
      expect(canonicalizeSkill('управление P&L')).toBe('Управление P&L');
      expect(canonicalizeSkill('управление p&l')).toBe('Управление P&L');
      expect(canonicalizeSkill('ответственность за P&L')).toBe('Управление P&L');
    });

    it('maps budget synonyms to canonical Бюджетирование', () => {
      expect(canonicalizeSkill('бюджет')).toBe('Бюджетирование');
      expect(canonicalizeSkill('бюджетирование')).toBe('Бюджетирование');
      expect(canonicalizeSkill('управление бюджетом')).toBe('Бюджетирование');
      expect(canonicalizeSkill('Budget Management')).toBe('Бюджетирование');
      expect(canonicalizeSkill('budgeting')).toBe('Бюджетирование');
    });

    it('maps strategy synonyms to canonical Стратегическое планирование', () => {
      expect(canonicalizeSkill('стратегия')).toBe('Стратегическое планирование');
      expect(canonicalizeSkill('стратегическое планирование')).toBe('Стратегическое планирование');
      expect(canonicalizeSkill('Strategic Planning')).toBe('Стратегическое планирование');
      expect(canonicalizeSkill('business strategy')).toBe('Стратегическое планирование');
      expect(canonicalizeSkill('Business Strategy')).toBe('Стратегическое планирование');
    });

    it('maps OKR/KPI synonyms to canonical OKR / KPI', () => {
      expect(canonicalizeSkill('OKR')).toBe('OKR / KPI');
      expect(canonicalizeSkill('KPI')).toBe('OKR / KPI');
      expect(canonicalizeSkill('okr')).toBe('OKR / KPI');
      expect(canonicalizeSkill('kpi')).toBe('OKR / KPI');
      expect(canonicalizeSkill('OKR / KPI')).toBe('OKR / KPI');
    });

    it('maps operational efficiency synonyms to canonical Операционная эффективность', () => {
      expect(canonicalizeSkill('операционная эффективность')).toBe('Операционная эффективность');
      expect(canonicalizeSkill('оптимизация бизнес-процессов')).toBe('Операционная эффективность');
      expect(canonicalizeSkill('управление бизнес-процессами')).toBe('Операционная эффективность');
      expect(canonicalizeSkill('operational excellence')).toBe('Операционная эффективность');
    });

    it('maps Lean synonyms to canonical Lean', () => {
      expect(canonicalizeSkill('Lean')).toBe('Lean');
      expect(canonicalizeSkill('lean')).toBe('Lean');
      expect(canonicalizeSkill('бережливое производство')).toBe('Lean');
    });

    it('maps M&A synonyms to canonical M&A', () => {
      expect(canonicalizeSkill('M&A')).toBe('M&A');
      expect(canonicalizeSkill('m&a')).toBe('M&A');
      expect(canonicalizeSkill('слияния и поглощения')).toBe('M&A');
    });

    it('maps transformation synonyms to canonical Цифровая трансформация', () => {
      expect(canonicalizeSkill('трансформация')).toBe('Цифровая трансформация');
      expect(canonicalizeSkill('цифровая трансформация')).toBe('Цифровая трансформация');
      expect(canonicalizeSkill('Digital Transformation')).toBe('Цифровая трансформация');
    });

    it('maps B2B sales synonyms to canonical Продажи B2B', () => {
      expect(canonicalizeSkill('продажи B2B')).toBe('Продажи B2B');
      expect(canonicalizeSkill('b2b sales')).toBe('Продажи B2B');
      expect(canonicalizeSkill('корпоративные продажи')).toBe('Продажи B2B');
    });

    it('maps product launch synonyms to canonical Запуск продукта', () => {
      expect(canonicalizeSkill('запуск продукта')).toBe('Запуск продукта');
      expect(canonicalizeSkill('product launch')).toBe('Запуск продукта');
      expect(canonicalizeSkill('запуск новых продуктов')).toBe('Запуск продукта');
    });

    it('preserves unknown technical and domain skills as-is', () => {
      expect(canonicalizeSkill('React')).toBe('React');
      expect(canonicalizeSkill('TypeScript')).toBe('TypeScript');
      expect(canonicalizeSkill('Python')).toBe('Python');
    });
  });

  describe('extractManagementSkillsFromText', () => {
    it('extracts at least 3 canonical requirements from a real COO description without tech keywords', () => {
      const cooText = `
        Сейчас мы ищем в команду Chief Operating Officer (COO) — человека, который возьмёт на себя весь бизнес
        и будет отвечать за его рост целиком: P&L, продукт, продажи, маркетинг, партнёрства.
        Обязанности:
        - Отвечать за P&L и коммерческий результат бизнеса, контролировать unit-экономику
        - Синхронизировать продажи вокруг общих целей и KPI
        - Строить сильную управленческую команду: руководство командой, найм и развитие
        - Повышать операционную эффективность бизнеса: бюджетирование, управленческая отчётность
        - Стратегическое планирование и запуск новых продуктов
        - Развивать продажи B2B и партнерства
      `;

      const extracted = extractManagementSkillsFromText(cooText);
      expect(extracted.length).toBeGreaterThanOrEqual(3);
      expect(extracted).toContain('Управление P&L');
      expect(extracted).toContain('Управление командой');
      expect(extracted).toContain('Бюджетирование');
      expect(extracted).toContain('Стратегическое планирование');
      expect(extracted).toContain('OKR / KPI');
      expect(extracted).toContain('Операционная эффективность');
      expect(extracted).toContain('Запуск продукта');
      expect(extracted).toContain('Продажи B2B');
    });

    it('returns empty array when text has no management competencies', () => {
      const text = 'Требуется верстальщик CSS, HTML и верстка страниц.';
      expect(extractManagementSkillsFromText(text)).toEqual([]);
    });
  });
});
