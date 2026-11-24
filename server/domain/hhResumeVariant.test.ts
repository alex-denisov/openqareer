import { describe, expect, it } from 'vitest';
import { checkHhResumeVariant, hhResumeVariantRequest, hhResumeVariantSubject, type HhResumeVariantInput } from './hhResumeVariant';

const base: HhResumeVariantInput = {
  edit: { id: 'skills', section: 'skills', was: 'Go', now: 'Go, C++', added: ['C++'] },
  language: 'ru', vacancyTitle: 'Тимлид', resumeSkills: ['Go'], profileSkills: ['C', 'C++'], profileFacts: [], avoid: ['Go, C++'],
};
const answer = (text: string, factIds: string[] = []) => ({ text, factIds });
const about = hhResumeVariantRequest({
  ...base, edit: { id: 'about', section: 'about', was: '', now: 'Сократил релиз до 3 дней на платёжной платформе.' },
  profileFacts: ['Вёл команду из 9 человек.'], avoid: [],
})!;

describe('B682: вариант правки резюме', () => {
  it('навыки: только из резюме и профиля, стоящие в резюме остаются, C и C++ различаются', () => {
    const request = hhResumeVariantRequest(base)!;
    expect(request.facts.map((fact) => fact.text)).toEqual(['Go', 'C++', 'C']);
    expect(checkHhResumeVariant(request, answer('c\nGo\nC++'))).toEqual({ text: 'C, Go, C++', added: ['C', 'C++'] });
    for (const text of ['C\nC++', 'Go\nRust', 'Go', 'Go\nGo\nC', 'Go\nC++']) expect(checkHhResumeVariant(request, answer(text))).toBeNull();
  });

  it('длинный список навыков резюме не режется; название вакансии обрезано и без служебных символов', () => {
    const many = Array.from({ length: 90 }, (_, i) => `Навык${i}`);
    const request = hhResumeVariantRequest({ ...base, resumeSkills: [...many, '—'], vacancyTitle: `a\u0000${'b'.repeat(500)}` })!;
    expect(request.vacancyTitle).toHaveLength(200);
    expect(checkHhResumeVariant(request, answer(['C', ...many].join('\n')))?.added).toEqual(['C']);
  });

  it('английский: чужое название внутри фразы — отказ', () => {
    const english = { ...about, language: 'en' as const, facts: [{ id: 'f1', text: 'Ran the billing platform on Kafka for three teams.' }] };
    expect(checkHhResumeVariant(english, answer('Kept billing running on Kafka across three teams.', ['f1']))).not.toBeNull();
    expect(checkHhResumeVariant(english, answer('Kept billing running on Kubernetes across three teams.', ['f1']))).toBeNull();
  });

  it('«О себе»: чужое число, ссылка, неизвестный факт — отказ', () => {
    expect(checkHhResumeVariant(about, answer('Вёл инженеров, команда из 9 специалистов.', ['f2']))?.text).toBe('Вёл инженеров, команда из 9 специалистов.');
    expect(checkHhResumeVariant(about, answer('Вёл команду, где 40 инженеров.', ['f2']))).toBeNull();
    expect(checkHhResumeVariant(about, answer('Пишите на a@b.ru про команду.', ['f2']))).toBeNull();
    expect(checkHhResumeVariant(about, answer('Вёл инженеров.', ['f9']))).toBeNull();
    expect(checkHhResumeVariant(about, answer('Вёл инженеров на Kubernetes.', ['f2']))).toBeNull();
  });

  it('у должности вариантов нет; ключ зависит от вакансии, резюме и содержимого, но не от номера места', () => {
    expect(hhResumeVariantRequest({ ...base, edit: { id: 'title', section: 'title', was: 'a', now: 'b' } })).toBeNull();
    const draft = { id: 'experience:0', section: 'experience', employer: 'Лаб', was: 'a', now: 'b', language: 'ru' } as const;
    const key = hhResumeVariantSubject('v', 'r', draft);
    expect(hhResumeVariantSubject('v', 'r', { ...draft, id: 'experience:4' })).toBe(key);
    for (const other of [hhResumeVariantSubject('v2', 'r', draft), hhResumeVariantSubject('v', 'r2', draft), hhResumeVariantSubject('v', 'r', { ...draft, now: 'c' })]) {
      expect(other).not.toBe(key);
    }
  });
});
