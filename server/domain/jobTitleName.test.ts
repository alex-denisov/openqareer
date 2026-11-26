import { describe, expect, it } from 'vitest';
import { isJobTitle } from './jobTitleName';
import { standardQuestions, withoutTitleQuestions } from './manualApplyQuestions';

describe('isJobTitle (Д15)', () => {
  it.each([
    'Engineering Manager',
    'Head of Engineering',
    'VP of Product',
    'CTO',
    'Chief Technology Officer',
    'Руководитель разработки',
    'Ведущий инженер',
  ])('%s — должность', (text) => expect(isJobTitle(text)).toBe(true));
  it.each([
    'Kubernetes',
    'People Management',
    'Google Tag Manager',
    'Leadership',
    'Управление командой',
    'Инженерия данных',
  ])('%s — навык', (text) => expect(isJobTitle(text)).toBe(false));
  it('сохранённый вопрос о должности не показывается', () => {
    const ask = (skill: string) => ({
      id: 'std-years-1',
      text: `Сколько лет опыта: ${skill}?`,
      required: true,
      kind: 'text' as const,
    });
    expect(withoutTitleQuestions([ask('Head of Engineering'), ask('Go')])).toEqual([ask('Go')]);
  });
  it('о должности лет опыта не спрашивают', () => {
    const texts = standardQuestions({
      vacancyId: 'v',
      skills: ['Engineering Manager', 'Kubernetes'],
    }).map(({ text }) => text);
    expect(texts).toContain('Сколько лет опыта: Kubernetes?');
    expect(texts.join()).not.toContain('Engineering Manager');
  });
});
