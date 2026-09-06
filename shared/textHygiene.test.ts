import { describe, expect, it } from 'vitest';
import { auditHiddenMarkers, stripHiddenMarkers, sanitizeHiddenMarkersDeep } from './textHygiene';

const ZWSP = '​';
const ZWNJ = '‌';
const ZWJ = '‍';
const BOM = '﻿';
const SOFT_HYPHEN = '­';
const WORD_JOINER = '⁠';
const LRM = '‎';
const TAG_A = '\u{E0061}';

describe('невидимые метки в тексте кандидата (B210)', () => {
  it('убирает невидимые символы из любого места строки', () => {
    expect(stripHiddenMarkers(`${ZWSP}Опыт${ZWSP} работы${ZWSP}`)).toBe('Опыт работы');
    expect(stripHiddenMarkers(`Senior${BOM} Engineer`)).toBe('Senior Engineer');
    expect(stripHiddenMarkers(`ре${SOFT_HYPHEN}зюме`)).toBe('резюме');
    expect(stripHiddenMarkers(`два${WORD_JOINER}слова`)).toBe('дваслова');
    expect(stripHiddenMarkers(`${LRM}Москва`)).toBe('Москва');
    expect(stripHiddenMarkers(`ноль${ZWNJ}ширины`)).toBe('нольширины');
  });

  it('убирает стеганографические теговые символы', () => {
    expect(stripHiddenMarkers(`Текст${TAG_A}${TAG_A}`)).toBe('Текст');
  });

  it('сохраняет пунктуацию, переносы строк и обычные пробелы', () => {
    const text = 'Первая строка.\n\n— Вторая: «третья», четвёртая пятая.';
    expect(stripHiddenMarkers(text)).toBe(text);
  });

  /**
   * ZWJ склеивает эмодзи в одну картинку. Снести его вслепую — разобрать
   * «👨‍💻» на двух человечков в тексте, который кандидат сам написал.
   */
  it('не разбирает составные эмодзи', () => {
    expect(stripHiddenMarkers(`Привет 👨${ZWJ}💻!`)).toBe(`Привет 👨${ZWJ}💻!`);
    expect(stripHiddenMarkers(`слово${ZWJ}слово`)).toBe('словослово');
  });

  it('считает найденное по видам и называет слова со смешанным алфавитом', () => {
    const audit = auditHiddenMarkers(`${ZWSP}Опыт${SOFT_HYPHEN} paбoты ${TAG_A}`);
    expect(audit.zeroWidth).toBe(1);
    expect(audit.softHyphen).toBe(1);
    expect(audit.tagCharacters).toBe(1);
    expect(audit.total).toBe(3);
    // «paбoты» — латинские p, a, o внутри русского слова.
    expect(audit.mixedScriptWords).toEqual(['paбoты']);
  });

  it('не объявляет смешанным слово с одним алфавитом или с цифрами', () => {
    const audit = auditHiddenMarkers('Опыт работы Senior Engineer 1С React 18');
    expect(audit.mixedScriptWords).toEqual([]);
    expect(audit.total).toBe(0);
  });

  it('чистит строки внутри вложенного объекта, не трогая остальное', () => {
    const value = sanitizeHiddenMarkersDeep({
      title: `Senior${ZWSP} Engineer`,
      count: 3,
      nested: { list: [`а${BOM}б`, null], flag: true },
    });
    expect(value).toEqual({
      title: 'Senior Engineer',
      count: 3,
      nested: { list: ['аб', null], flag: true },
    });
  });

  it('возвращает тот же объект, когда чистить нечего', () => {
    const source = { title: 'Senior Engineer', nested: { list: ['аб'] } };
    expect(sanitizeHiddenMarkersDeep(source)).toBe(source);
  });
});
