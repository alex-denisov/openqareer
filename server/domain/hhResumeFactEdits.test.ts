import { describe, expect, it } from 'vitest';
import { draftHhResumeEdits, type HhEditsInput } from './hhResumeEdits';
import { correctedText } from './hhResumeFactEdits';

const FACTS = ['Рентабельность направления 40 % по итогам 2024 года'];

describe('B787: правка «исправить факт»', () => {
  it('меняет только расходящееся число показателя', () => {
    expect(correctedText('Вывел направление на рентабельность 80% за два года.', FACTS)).toBe(
      'Вывел направление на рентабельность 40 % за два года.',
    );
  });

  it('не трогает совпадающие числа и проценты без показателя; верно последнее подтверждённое', () => {
    expect(correctedText('Рентабельность 40%.', FACTS)).toBe('Рентабельность 40%.');
    expect(correctedText('Рост выручки 80%.', FACTS)).toBe('Рост выручки 80%.');
    expect(correctedText('Рентабельность 80%.', [...FACTS, 'рентабельность 35 %'])).toBe(
      'Рентабельность 80%.',
    );
  });

  it('у места без своей правки появляется правка факта с работодателем и должностью', () => {
    const input: HhEditsInput = {
      resume: {
        id: 'r1',
        title: 'CIO',
        sections: {
          title: 'CIO',
          about: '',
          aboutRead: true,
          skills: [],
          places: [
            {
              employer: 'Ромашка',
              title: 'CIO',
              period: '2020 — н.в.',
              text: 'Рентабельность 80 %.',
            },
          ],
        },
      },
      vacancy: { title: 'CIO', requirements: [] },
      platform: { about: null, places: [], facts: FACTS, confirmed: FACTS },
    } as unknown as HhEditsInput;
    const edits = draftHhResumeEdits(input);
    expect(edits).toEqual([
      expect.objectContaining({
        id: 'fact:experience:0',
        section: 'experience',
        employer: 'Ромашка',
        position: 'CIO',
        was: 'Рентабельность 80 %.',
        now: 'Рентабельность 40 %.',
      }),
    ]);
  });
});

describe('B787: факт консультанта «с 16% до 40%»', () => {
  const said = ['Подняла маржинальность направления с 16% до 40% за два года'];
  it('берёт второе число диапазона и узнаёт маржу как рентабельность', () => {
    expect(correctedText('Рентабельность направления 80 %.', said)).toBe('Рентабельность направления 40 %.');
  });
  it('в резюме диапазон «с 16 % до 80 %» правит только конечное число', () => {
    expect(correctedText('Рентабельность выросла с 16 % до 80 %.', said)).toBe('Рентабельность выросла с 16 % до 40 %.');
  });
});

describe('B787: правка места из профиля не переносит старое число', () => {
  it('«станет» правки опыта исправлено по подтверждённому факту', () => {
    const input = {
      resume: {
        id: 'r1',
        title: 'CIO',
        sections: { title: 'CIO', about: '', aboutRead: true, skills: [], places: [{ employer: 'Fishance', title: 'CEO', period: '2019', text: 'Старый текст.' }] },
      },
      vacancy: { title: 'CIO', requirements: [] },
      platform: {
        about: null,
        places: [{ id: 'p1', employer: 'Fishance', aliases: [], bullets: ['Рентабельность 80 %.'] }],
        facts: ['Рентабельность 80 %.', 'Подняла маржу с 16% до 40%'],
        confirmed: ['Подняла маржу с 16% до 40%'],
      },
    } as unknown as HhEditsInput;
    expect(draftHhResumeEdits(input)[0]).toMatchObject({ now: 'Рентабельность 40 %.', lines: ['Рентабельность 40 %.'] });
  });
});
