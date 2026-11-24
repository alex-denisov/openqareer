import { describe, expect, it } from 'vitest';
import { draftHhResumeEdits, hhResumeLanguage, type HhEditsInput } from './hhResumeEdits';

const input: HhEditsInput = {
  resume: {
    id: 'coo',
    title: 'Операционный директор',
    sections: {
      title: 'Операционный директор',
      about: 'Руковожу операциями 10 лет.',
      aboutRead: true,
      skills: ['Управление проектами', 'ITIL'],
      places: [
        { employer: 'АО «Россети Цифра»', title: 'Директор по поддержке', period: 'апр 2023 — окт 2025', text: 'Отвечал за поддержку продуктов.' },
        { employer: 'Kaspersky', title: 'Premium Support Lead', period: 'апр 2010 — май 2012', text: 'Вёл премиальную поддержку.' },
        { employer: 'ООО Ромашка', title: 'Инженер', period: '2008 — 2010', text: 'Чинил серверы.' },
      ],
    },
  },
  otherTitles: ['Руководитель ИТ'],
  vacancy: { title: 'COO в ИТ-компанию', titleFits: true, requirements: ['ITIL', 'Бюджетирование', 'Kubernetes'] },
  platform: {
    about: 'Строю операционные функции ИТ-компаний.',
    places: [
      {
        id: 'w1',
        employer: 'Россети Цифра',
        aliases: [],
        bullets: ['Выручка выросла с 230 до 920 млн руб. в год.', 'Отвечал за поддержку продуктов.', 'Вёл бюджетирование направления.'],
      },
      { id: 'w2', employer: 'Kaspersky Lab', aliases: [], bullets: [] },
    ],
    facts: ['Вёл бюджетирование направления.', 'ITIL 4'],
  },
};

describe('B678: правки резюме hh.ru «было → станет»', () => {
  it('должность, опыт по местам, навыки и «о себе» — только там, где платформе есть что добавить', () => {
    const edits = draftHhResumeEdits(input);

    expect(edits).toEqual([
      { id: 'title', section: 'title', was: 'Операционный директор', now: 'COO в ИТ-компанию', language: 'ru' },
      {
        id: 'experience:0',
        section: 'experience',
        place: 'АО «Россети Цифра» · апр 2023 — окт 2025',
        employer: 'АО «Россети Цифра»',
        position: 'Директор по поддержке',
        was: 'Отвечал за поддержку продуктов.',
        now: 'Выручка выросла с 230 до 920 млн руб. в год.\nОтвечал за поддержку продуктов.\nВёл бюджетирование направления.',
        language: 'ru',
        lines: ['Выручка выросла с 230 до 920 млн руб. в год.', 'Отвечал за поддержку продуктов.', 'Вёл бюджетирование направления.'],
      },
      {
        id: 'skills',
        section: 'skills',
        was: 'Управление проектами, ITIL',
        now: 'Управление проектами, ITIL, Бюджетирование',
        language: 'ru',
        added: ['Бюджетирование'],
      },
      { id: 'about', section: 'about', was: 'Руковожу операциями 10 лет.', now: 'Строю операционные функции ИТ-компаний.', language: 'ru' },
    ]);
  });

  it('место без пунктов на платформе и место, которого на платформе нет, правок не получают', () => {
    const edits = draftHhResumeEdits(input).filter((edit) => edit.section === 'experience');
    expect(edits.map((edit) => edit.id)).toEqual(['experience:0']);
  });

  it('навык, которого профиль не подтверждает, не добавляется: Kubernetes нет в фактах', () => {
    const skills = draftHhResumeEdits(input).find((edit) => edit.section === 'skills');
    expect(skills?.now).not.toContain('Kubernetes');
  });

  it('должность не повторяет другое резюме кандидата и не меняется, если уже про вакансию', () => {
    const clash = draftHhResumeEdits({ ...input, otherTitles: ['COO в ИТ-компанию'] });
    expect(clash.some((edit) => edit.section === 'title')).toBe(false);
    const same = draftHhResumeEdits({
      ...input,
      resume: { ...input.resume, title: 'COO в ИТ-компанию', sections: { ...input.resume.sections, title: 'COO в ИТ-компанию' } },
    });
    expect(same.some((edit) => edit.section === 'title')).toBe(false);
  });

  it('текст платформы на другом языке помечен языком: его переводят, прежде чем показать', () => {
    const english = draftHhResumeEdits({
      ...input,
      platform: { ...input.platform, about: 'Build operations of IT companies.', places: [{ ...input.platform.places[0]!, bullets: ['Grew revenue from 230 to 920 mln rub.'] }] },
    });
    expect(english.find((edit) => edit.section === 'about')?.language).toBe('en');
    expect(english.find((edit) => edit.section === 'experience')?.language).toBe('en');
    expect(hhResumeLanguage(input.resume.sections)).toBe('ru');
  });

  it('совпадающий текст правкой не считается', () => {
    const edits = draftHhResumeEdits({
      ...input,
      platform: { ...input.platform, about: 'Руковожу операциями 10 лет.', places: [{ ...input.platform.places[0]!, bullets: ['Отвечал за поддержку продуктов.'] }] },
    });
    expect(edits.map((edit) => edit.section)).toEqual(['title', 'skills']);
  });

  it('место профиля достаётся одному месту hh.ru, короткий ключ работодателя ни с чем не совпадает', () => {
    const twice = draftHhResumeEdits({
      ...input,
      resume: {
        ...input.resume,
        sections: {
          ...input.resume.sections,
          places: [
            { employer: 'Россети Цифра', title: 'Директор', period: '2023 — 2025', text: 'Поддержка.' },
            { employer: 'Россети Цифра', title: 'Руководитель', period: '2021 — 2023', text: 'Поддержка.' },
            { employer: 'IT', title: 'Инженер', period: '2019 — 2021', text: 'Сервис.' },
          ],
        },
      },
      platform: { ...input.platform, places: [...input.platform.places, { id: 'w3', employer: 'IT Solutions', aliases: [], bullets: ['Поднял сервис.'] }] },
    }).filter((edit) => edit.section === 'experience');
    expect(twice.map((edit) => edit.id)).toEqual(['experience:0']);
  });

  it('требование длиннее навыка в навыки не попадает', () => {
    const long = 'Опыт построения операционной функции в компании с выручкой от миллиарда рублей и командой больше ста человек';
    const skills = draftHhResumeEdits({
      ...input,
      vacancy: { ...input.vacancy, requirements: [long] },
      platform: { ...input.platform, facts: [long] },
    }).find((edit) => edit.section === 'skills');
    expect(skills).toBeUndefined();
  });

  it('название не из ролей кандидата — должность не меняется (24.11 «Receptionist»)', () => {
    const edits = draftHhResumeEdits({ ...input, vacancy: { ...input.vacancy, title: 'Receptionist', titleFits: false } });
    expect(edits.some((edit) => edit.section === 'title')).toBe(false);
  });

  it('условия поиска из старого снимка не показываются как «О себе»', () => {
    const about = 'Уровень дохода не указан · Постоянная работа, Подработка · Гибрид, Удалённо · Могу приезжать в командировки';
    const sections = { ...input.resume.sections, about };
    const edits = draftHhResumeEdits({ ...input, resume: { ...input.resume, sections } });
    expect(edits.some((edit) => edit.section === 'about')).toBe(false);
  });

  it('«О себе» правится только прочитанное: пустое без признака и старый снимок — нет', () => {
    const aboutOf = (about: string, aboutRead?: boolean) => {
      const sections = { ...input.resume.sections, about, aboutRead };
      return draftHhResumeEdits({ ...input, resume: { ...input.resume, sections } }).find((edit) => edit.section === 'about');
    };
    expect(aboutOf('')).toBeUndefined();
    expect(aboutOf('', false)).toBeUndefined();
    expect(aboutOf('Старый текст')).toBeUndefined();
    expect(aboutOf('', true)).toMatchObject({ was: '' });
  });
});
