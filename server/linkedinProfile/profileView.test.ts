import { describe, expect, it } from 'vitest';
import { offerOf, profileSections, shownTexts } from './profileView';

const current = {
  lines: { headline: 'Сейчас', about: null, education: 'МГТУ', courses: null, skills: 'Go', languages: 'Русский — родной' },
  places: [{ id: 'e1', label: 'Лаб · Тимлид', current: 'Вёл.' }, { id: 'e2', label: 'Сфера · Бэкенд', current: null }],
};
const suggestions = {
  headline: { text: 'Новый заголовок', facts: [] },
  about: null,
  experience: { text: '', facts: [], items: [{ id: 'e1', label: 'Лаб · Тимлид', text: 'Пересказ', facts: [] }] },
  skills: { text: 'Go · SQL', facts: [] },
};
const marks = { done: new Map([['headline', '2026-11-19T10:00:00.000Z']]), variants: new Map([['skills', ['SQL · Go']]]) };

describe('B645 a03: семь разделов', () => {
  it('порядок макета, предложения у заголовка, «О себе», опыта и навыков', () => {
    const sections = profileSections(current, suggestions, marks);
    expect(sections.map((section) => section.id)).toEqual(['headline', 'about', 'experience', 'education', 'courses', 'skills', 'languages']);
    expect(sections[0]).toEqual({
      id: 'headline', current: 'Сейчас',
      offer: { key: 'headline', text: 'Новый заголовок', variantsLeft: 3, doneAt: '2026-11-19T10:00:00.000Z' },
    });
    expect(sections[1]!.offer).toBeNull();
    expect(sections[2]!.places).toEqual([
      { id: 'e1', label: 'Лаб · Тимлид', current: 'Вёл.', offer: { key: 'experience:e1', text: 'Пересказ', variantsLeft: 3, doneAt: null } },
      { id: 'e2', label: 'Сфера · Бэкенд', current: null, offer: null },
    ]);
    expect(sections[3]).toEqual({ id: 'education', current: 'МГТУ', offer: null });
    expect(sections[5]!.offer).toEqual({ key: 'skills', text: 'SQL · Go', variantsLeft: 2, doneAt: null });
  });

  it('вариантов больше нет — осталось 0; прежние тексты идут в «не повторять»', () => {
    const full = { done: new Map(), variants: new Map([['about', ['a', 'b', 'c']]]) };
    expect(offerOf('about', null, full)).toMatchObject({ text: 'c', variantsLeft: 0 });
    expect(shownTexts('skills', suggestions, marks)).toEqual(['Go · SQL', 'SQL · Go']);
    expect(shownTexts('experience:e1', suggestions, marks)).toEqual(['Пересказ']);
  });
});
