import { describe, expect, it } from 'vitest';
import type { ResumeDraft, ResumeExperienceInput } from '../../resume/resumeTypes';
import { createTextKeys, editedTexts } from './experienceResults';
import {
  applyForm,
  citySuggestions,
  formOf,
  restoreEntry,
  monthLabel,
  reviewRows,
  validateForm,
  withDescription,
} from './experienceForm';

const ENTRY: ResumeExperienceInput = {
  id: 'e2',
  chronologyMemoryId: 'm0',
  title: 'Руководитель группы бэкенда',
  employer: 'Сфера Платежи',
  location: 'Москва',
  startDate: '2018-03',
  endDate: '2021-01',
  current: false,
  bulletMemoryIds: ['m1'],
  workplaceType: 'remote',
  teamSize: 18,
  skills: ['Go', 'PostgreSQL'],
};

const DRAFT = {
  candidate: {},
  experience: [{ ...ENTRY, id: 'e1', employer: 'Финтех Лаб' }, ENTRY],
  education: [],
  languages: [],
} as unknown as ResumeDraft;

describe('b640 profile: форма места работы', () => {
  it('заполняется из записи', () => {
    expect(formOf(ENTRY)).toEqual({
      employer: 'Сфера Платежи',
      title: 'Руководитель группы бэкенда',
      start: '2018-03',
      end: '2021-01',
      current: false,
      city: 'Москва',
      workplaceType: 'remote',
      teamSize: '18',
      skills: ['Go', 'PostgreSQL'],
      description: '',
      results: [],
      removed: [],
    });
    expect(
      formOf({ ...ENTRY, startDate: 'март 2018', teamSize: undefined, workplaceType: undefined }),
    ).toMatchObject({
      start: '2018-03',
      teamSize: '',
      workplaceType: null,
    });
  });

  it('B801: «Что делали» есть и у места без описания; новая запись встаёт в это место', () => {
    expect(formOf({ ...ENTRY, descriptionMemoryId: 'd9' }).description).toBeNull();
    const draft = { ...DRAFT, experience: [ENTRY] };
    expect(withDescription(draft, ENTRY.id, 'd1').experience[0].descriptionMemoryId).toBe('d1');
    expect(withDescription(draft, ENTRY.id, null)).toBe(draft);
    const keyOf = createTextKeys();
    expect(keyOf('а')).toBe(keyOf('а'));
    expect(keyOf('б')).not.toBe(keyOf('а'));
  });

  it('результаты и описание берутся из записей; убранный результат уходит из места работы', () => {
    const entry = { ...ENTRY, descriptionMemoryId: 'd1', bulletMemoryIds: ['m1', 'm2'] };
    const statements = new Map([
      ['d1', 'Вела бэкенд'],
      ['m1', 'Маржа 80 %'],
      ['m2', 'SLA 99 %'],
    ]);
    const form = formOf(entry, statements);
    expect(form.description).toBe('Вела бэкенд');
    expect(form.results.map(({ text }) => text)).toEqual(['Маржа 80 %', 'SLA 99 %']);
    const draft = { ...DRAFT, experience: [entry] };
    const next = applyForm(draft, 'e2', { ...form, removed: ['m1'] });
    expect(next.experience[0].bulletMemoryIds).toEqual(['m2']);
    const edited = {
      ...form,
      results: form.results.map((row) => ({ ...row, text: row.text.replace('80', '40') })),
    };
    expect(editedTexts(entry, form, edited)).toEqual([{ memoryId: 'm1', text: 'Маржа 40 %' }]);
  });

  it('месяц подписывается словами', () => {
    expect(monthLabel('2018-03')).toBe('Март 2018');
    expect(monthLabel('')).toBe('');
  });

  it('проверяет обязательные поля, период, город и команду', () => {
    const form = formOf(ENTRY);
    expect(validateForm(form, ENTRY)).toEqual({});
    expect(validateForm({ ...form, employer: ' ', title: '' }, ENTRY)).toEqual({
      employer: 'Укажите компанию',
      title: 'Укажите должность',
    });
    expect(validateForm({ ...form, end: '2017-01' }, ENTRY)).toEqual({
      period: 'Окончание раньше начала',
    });
    expect(validateForm({ ...form, end: '2017-01', current: true }, ENTRY)).toEqual({});
    expect(validateForm({ ...form, start: '' }, ENTRY)).toEqual({ period: 'Укажите начало' });
    expect(validateForm({ ...form, city: 'Мсква' }, ENTRY)).toEqual({
      city: 'Нет в справочнике — выберите из списка',
    });
    expect(validateForm({ ...form, teamSize: 'много' }, ENTRY)).toEqual({
      teamSize: 'Только число',
    });
    expect(validateForm({ ...form, city: '', teamSize: '' }, ENTRY)).toEqual({});
  });

  it('прежний город вне справочника не мешает сохранить другие поля', () => {
    const legacy = { ...ENTRY, location: 'Москва, Россия' };
    expect(validateForm(formOf(legacy), legacy)).toEqual({});
  });

  it('подсказывает города из справочника', () => {
    expect(citySuggestions('мос')).toContain('Москва');
    expect(citySuggestions('санкт')).toEqual(['Санкт-Петербург']);
    expect(citySuggestions('')).toEqual([]);
    expect(citySuggestions('м').length).toBeLessThanOrEqual(8);
  });

  it('записывает форму в свою запись, не трогая прочие поля и записи', () => {
    const form = {
      ...formOf(ENTRY),
      employer: ' Сфера Пэй ',
      end: '',
      current: true,
      city: '',
      teamSize: '',
      workplaceType: null,
      skills: ['Go'],
    };
    const next = applyForm(DRAFT, 'e2', form);
    expect(next.experience[0]).toBe(DRAFT.experience[0]);
    expect(next.experience[1]).toEqual({
      id: 'e2',
      chronologyMemoryId: 'm0',
      title: 'Руководитель группы бэкенда',
      employer: 'Сфера Пэй',
      startDate: '2018-03',
      current: true,
      bulletMemoryIds: ['m1'],
      skills: ['Go'],
    });
    expect(DRAFT.experience[1]).toEqual(ENTRY);
  });

  it('даты, которые кандидат не трогал, остаются в прежнем написании', () => {
    const entry = { ...ENTRY, startDate: '2018', endDate: 'весна 2021' };
    const draft = { ...DRAFT, experience: [entry] } as ResumeDraft;
    expect(validateForm(formOf(entry), entry)).toEqual({});
    const next = applyForm(draft, 'e2', { ...formOf(entry), teamSize: '5' });
    expect(next.experience[0]).toMatchObject({
      startDate: '2018',
      endDate: 'весна 2021',
      teamSize: 5,
    });
    const moved = applyForm(draft, 'e2', { ...formOf(entry), start: '2018-06' });
    expect(moved.experience[0].startDate).toBe('2018-06');
  });

  it('начало словами не мешает сохранить другие поля; пустое начало без прежнего — ошибка', () => {
    const worded = { ...ENTRY, startDate: 'весна 2018' };
    expect(validateForm(formOf(worded), worded)).toEqual({});
    const empty = { ...ENTRY, startDate: undefined };
    expect(validateForm(formOf(empty), empty)).toEqual({ period: 'Укажите начало' });
  });

  it('при смене названия компании прежние сведения о настоящем названии убирает', () => {
    const entry = {
      ...ENTRY,
      employerRealName: 'ООО Сфера',
      employerNameMemoryId: 'mm',
      employerMaskKept: true,
    };
    const draft = { ...DRAFT, experience: [entry] } as ResumeDraft;
    const same = applyForm(draft, 'e2', formOf(entry)).experience[0];
    expect(same).toMatchObject({
      employerRealName: 'ООО Сфера',
      employerNameMemoryId: 'mm',
      employerMaskKept: true,
    });
    const renamed = applyForm(draft, 'e2', { ...formOf(entry), employer: 'Другая' }).experience[0];
    expect(renamed.employerRealName).toBeUndefined();
    expect(renamed.employerNameMemoryId).toBeUndefined();
    expect(renamed.employerMaskKept).toBeUndefined();
  });

  it('«Отменить» возвращает прежнюю запись, не трогая остальные', () => {
    const edited = applyForm(DRAFT, 'e2', { ...formOf(ENTRY), employer: 'Другая' });
    const fresh = {
      ...edited,
      experience: [{ ...edited.experience[0], title: 'Новое' }, edited.experience[1]],
    };
    const restored = restoreEntry(fresh as ResumeDraft, ENTRY);
    expect(restored.experience[0].title).toBe('Новое');
    expect(restored.experience[1]).toEqual(ENTRY);
  });

  it('команду записывает числом', () => {
    const next = applyForm(DRAFT, 'e2', { ...formOf(ENTRY), teamSize: '9' });
    expect(next.experience[1].teamSize).toBe(9);
  });
});

describe('b640 profile: проверка записей', () => {
  it('строка проверки: компания, даты, команда и отметка подтверждения', () => {
    const memory = [{ id: 'm1', status: 'confirmed', confidence: 'candidate-confirmed' }] as never;
    expect(reviewRows(DRAFT, memory)[1]).toEqual({
      id: 'e2',
      title: 'Руководитель группы бэкенда',
      employer: 'Сфера Платежи',
      period: '2018 — 2021',
      team: '18 человек',
      confirmed: true,
      editPath: '/app/profile/experience/e2',
    });
    expect(reviewRows(DRAFT, [])[1].confirmed).toBe(false);
  });
});
