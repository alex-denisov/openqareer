import { describe, expect, it } from 'vitest';
import {
  bulletAt,
  checkFactRewriteVariant,
  factRewriteVariantRequest,
  factRewriteVariantSubject,
  withBulletVariant,
} from './factRewriteVariant';

const bullet = { text: 'Руководила группой бэкенда из 18 человек.', sourceFactIds: ['f1'], experienceId: 'e1' };
const proposal = {
  id: 'p1',
  places: [{ experienceId: 'e1', bullets: [{ text: 'Другой пункт.', sourceFactIds: ['f2'] }, bullet] }],
  leftOutFactIds: ['f3'],
  sourceFactIds: ['f1', 'f2', 'f3'],
};
const source = {
  places: [{ experienceId: 'e1', employer: 'Сфера Платежи', title: 'Руководитель', period: '2018', existingBullets: [], language: 'ru' as const }],
  facts: [
    { id: 'f1', domain: 'outcome', statement: 'команда бэкенда на Kotlin была восемнадцать, то есть 18 человек' },
    { id: 'f2', domain: 'outcome', statement: 'секретный факт 77' },
  ],
};
const wish = { chips: ['shorter' as const], text: '' };
const request = factRewriteVariantRequest(source, bullet, ['Вела бэкенд из 18 человек.'], wish)!;
const check = (text: string) => checkFactRewriteVariant(request, { text });

describe('B786: «Другой вариант» пункта резюме', () => {
  it('в модель уходят только факты пункта, прежние тексты и пожелание', () => {
    expect(request.facts.map((fact) => fact.id)).toEqual(['f1']);
    expect(request.avoid).toEqual([bullet.text, 'Вела бэкенд из 18 человек.']);
    expect(request.wish).toContain('короче');
    expect(factRewriteVariantRequest({ ...source, facts: [] }, bullet, [], wish)).toBeNull();
    expect(factRewriteVariantRequest({ ...source, places: [] }, bullet, [], wish)).toBeNull();
  });

  it('другой текст по тем же фактам принимается', () => {
    expect(check('Возглавляла бэкенд на Kotlin: 18 человек в группе')).toBe('Возглавляла бэкенд на Kotlin: 18 человек в группе.');
    expect(check('Руководила бэкендом в Сфере Платежи, 18 человек.')).not.toBeNull();
  });

  it.each([
    ['чужое число', 'Руководила группой бэкенда из 20 человек.'],
    ['число соседнего факта', 'Руководила группой бэкенда из 77 человек.'],
    ['новое название латиницей', 'Руководила группой из 18 человек на Kubernetes.'],
    ['новое название кириллицей', 'Руководила группой из 18 человек в Сбербанке.'],
    ['первое лицо', 'Мы вели бэкенд из 18 человек.'],
    ['другой язык', 'Led a backend group of 18 engineers on Kotlin.'],
    ['повтор исходного', ' руководила группой бэкенда из 18 человек '],
    ['повтор варианта', 'Вела бэкенд — из 18 человек!'],
    ['пусто', ' '],
  ])('отклоняется: %s', (_name, text) => {
    expect(check(text)).toBeNull();
  });

  it('у английского места факты на русском: латинские названия — из показанного пункта', () => {
    const english = { ...request, place: { ...request.place, language: 'en' as const }, current: 'Led the Kafka team of 18 engineers.' };
    expect(checkFactRewriteVariant(english, { text: 'Headed an 18-strong engineering team on Kafka.' })).not.toBeNull();
    expect(checkFactRewriteVariant(english, { text: 'Headed an 18-strong engineering team on Oracle.' })).toBeNull();
  });

  it('применяется один пункт с текстом варианта, остальные факты не теряются', () => {
    const chosen = withBulletVariant(proposal, 'e1#1', 'Вела бэкенд из 18 человек');
    expect(chosen.places).toEqual([{ experienceId: 'e1', bullets: [expect.objectContaining({ text: 'Вела бэкенд из 18 человек.' })] }]);
    expect(chosen.leftOutFactIds).toEqual([]);
  });

  it('пункт ищется по ключу; варианты — у своего предложения', () => {
    expect(bulletAt(proposal, 'e1#1')).toMatchObject({ experienceId: 'e1', text: bullet.text });
    expect(bulletAt(proposal, 'e1#9')).toBeNull();
    expect(factRewriteVariantSubject('p1', 'e1#1')).not.toBe(factRewriteVariantSubject('p2', 'e1#1'));
  });
});
