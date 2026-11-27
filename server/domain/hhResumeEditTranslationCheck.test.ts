import { describe, expect, it } from 'vitest';
import { checkedTranslation } from './hhResumeEditTranslation';

describe('B787: проверка перевода строки правки hh.ru', () => {
  it('пункт с глаголом кандидата: «Grew…» → «Увеличил…» проходит', () => {
    expect(
      checkedTranslation(
        'Grew revenue from 230 to 920 million rubles (+300%).',
        'Увеличил выручку с 230 до 920 млн рублей (+300%).',
        'ru',
      ),
    ).not.toBeNull();
    expect(
      checkedTranslation(
        'Improved profitability from 16% to 40% through automation.',
        'Увеличил рентабельность с 16% до 40% за счёт автоматизации.',
        'ru',
      ),
    ).not.toBeNull();
  });

  it('событие без субъекта не становится действием кандидата', () => {
    expect(
      checkedTranslation(
        'The team grew from 4 to 11 engineers.',
        'Увеличил команду с 4 до 11 инженеров.',
        'ru',
      ),
    ).toBeNull();
  });

  it('«О себе» длиннее пункта и в первом лице, как исходник', () => {
    const source = `I build IT operations. ${'Built a support platform for 920 clients. '.repeat(10)}`;
    const answer = `Я строю ИТ-операции. ${'Построил платформу поддержки для 920 клиентов. '.repeat(10)}`;
    expect(checkedTranslation(source, answer, 'ru')).toBe(answer.trim());
  });

  it('по-прежнему не пропускает чужих чисел, другого языка и «я», которого нет в исходнике', () => {
    expect(
      checkedTranslation(
        'Grew revenue to 920 million rubles.',
        'Увеличил выручку до 950 млн рублей.',
        'ru',
      ),
    ).toBeNull();
    expect(
      checkedTranslation(
        'Grew revenue to 920 million rubles.',
        'Grew revenue to 920 million rubles.',
        'ru',
      ),
    ).toBeNull();
    expect(
      checkedTranslation(
        'Grew revenue to 920 million rubles.',
        'Я увеличил выручку до 920 млн рублей.',
        'ru',
      ),
    ).toBeNull();
  });
});
