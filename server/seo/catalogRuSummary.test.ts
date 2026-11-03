import { describe, expect, it } from 'vitest';
import {
  catalogRuSummaryInput,
  catalogSummarySourceHash,
  catalogSummarySourceText,
  parseCatalogRuSummary,
  readStoredCatalogRuSummary,
  type CatalogRuSummarySource,
} from './catalogRuSummary';

const source: CatalogRuSummarySource = {
  title: 'Manager, Meetings Operations',
  company: 'Autodesk',
  location: 'Toronto, Canada',
  isRemote: true,
  description:
    'We are hiring a manager for meetings operations. You will run 40 events a year. ' +
    'Candidates from Canada and the United States are welcome. 5+ years of event management. ' +
    'Contact jobs@autodesk.com or https://autodesk.com/apply',
};

const answer = {
  summary:
    'Autodesk ищет менеджера, который будет вести операционную часть деловых встреч и мероприятий. ' +
    'За год предстоит провести около 40 событий. Работа удалённая, кандидатов ждут из Канады и США.',
  role: 'Менеджер по операциям мероприятий',
  format: 'Удалённо',
  geography: 'Канада и США',
  requirements: [
    'Опыт организации мероприятий от 5 лет',
    '  ',
    'Очень длинное требование '.repeat(8),
  ],
  audience: null,
};

describe('catalog Russian summary', () => {
  it('keeps the facts the text states and drops the empty ones', () => {
    const result = parseCatalogRuSummary(JSON.stringify(answer), source);
    expect(result).toEqual({
      summary: {
        text: answer.summary,
        facts: {
          role: 'Менеджер по операциям мероприятий',
          format: 'Удалённо',
          geography: 'Канада и США',
          requirements: ['Опыт организации мероприятий от 5 лет'],
        },
      },
    });
  });

  it('drops facts left in English instead of showing them under a Russian label', () => {
    const english = {
      ...answer,
      role: 'Manager, senior',
      geography: 'United States',
      requirements: ['7+ years of meetings experience', 'Администрирование Cvent и Aventri'],
    };
    const result = parseCatalogRuSummary(JSON.stringify(english), source);
    expect(result).toMatchObject({
      summary: {
        facts: { format: 'Удалённо', requirements: ['Администрирование Cvent и Aventri'] },
      },
    });
    expect('summary' in result ? result.summary.facts.role : 'none').toBeUndefined();
    expect('summary' in result ? result.summary.facts.geography : 'none').toBeUndefined();
  });

  it('accepts an answer fenced as a json block', () => {
    const result = parseCatalogRuSummary(`\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``, source);
    expect('summary' in result).toBe(true);
  });

  it('refuses a number the text does not contain', () => {
    const invented = { ...answer, summary: `${answer.summary} Зарплата до 150 000 рублей.` };
    expect(parseCatalogRuSummary(JSON.stringify(invented), source)).toEqual({
      issue: 'invented_number',
    });
  });

  it('refuses an English answer, a single sentence and a non-JSON answer', () => {
    const english = {
      ...answer,
      summary: 'Autodesk is hiring a manager. The role is remote. Apply now.',
    };
    expect(parseCatalogRuSummary(JSON.stringify(english), source)).toEqual({
      issue: 'not_russian',
    });
    const short = { ...answer, summary: 'Autodesk ищет менеджера мероприятий' };
    expect(parseCatalogRuSummary(JSON.stringify(short), source)).toEqual({ issue: 'sentences' });
    expect(parseCatalogRuSummary('Конечно! Вот справка.', source)).toEqual({ issue: 'not_json' });
    expect(parseCatalogRuSummary('{"role":"x"}', source)).toEqual({ issue: 'shape' });
  });

  it('removes contacts and links from the model input', () => {
    const input = catalogRuSummaryInput({ ...source, description: `<p>${source.description}</p>` });
    expect(input).toContain('Должность: Manager, Meetings Operations');
    expect(input).toContain('Место: Toronto, Canada, удалённо');
    expect(input).not.toContain('jobs@autodesk.com');
    expect(input).not.toContain('https://');
    expect(input).not.toContain('<p>');
  });

  it('binds the hash to the title and the text, not to whitespace around them', () => {
    const hash = catalogSummarySourceHash('Бухгалтер', 'Текст');
    expect(catalogSummarySourceHash(' Бухгалтер ', 'Текст\n')).toBe(hash);
    expect(catalogSummarySourceHash('Бухгалтер', 'Другой текст')).not.toBe(hash);
  });

  it('picks the first non-blank text the page would show', () => {
    expect(catalogSummarySourceText('  ', undefined, 'описание')).toBe('описание');
    expect(catalogSummarySourceText(undefined, '')).toBe('');
  });

  it('reads back only a stored summary of the current shape', () => {
    expect(readStoredCatalogRuSummary('{"text":"Т.","facts":{}}')).toEqual({
      text: 'Т.',
      facts: {},
    });
    expect(readStoredCatalogRuSummary('{"text":""}')).toBeUndefined();
    expect(readStoredCatalogRuSummary('not json')).toBeUndefined();
  });
});
