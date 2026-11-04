import { describe, expect, it } from 'vitest';
import { deriveCandidateTargetLevel } from './candidateLevel';
import { careerRoleRowKey, careerRoleKey, sameCareerRole } from './careerRoleKey';
import { withPositionRoles, type PositionRole } from './careerRoleLadder';
import {
  campaignFunctionLevelFloors,
  candidateRoleFunctionCodes,
} from './titleParse/candidateRoleFunctions';

function auto(title: string, titleRu: string, level: PositionRole['level'], fn: string): PositionRole {
  return {
    title,
    titleRu,
    level,
    functions: [fn],
    evidenceRefs: ['memory:1'],
    reason: 'Роль выбрана по должностям и фактам профиля.',
  };
}

const CTO = auto('Chief Technology Officer', 'Технический директор (CTO)', 'c-level', 'eng-mgmt');
const CIO = auto(
  'Chief Information Officer',
  'Директор по информационным технологиям (CIO)',
  'c-level',
  'it-ops',
);

describe('строка роли на «Карьере»: первое лицо отдельно от директора (04.11)', () => {
  it('CIO и «Директор по ИТ» — разные строки', () => {
    expect(careerRoleRowKey('Chief Information Officer')).not.toBe(careerRoleRowKey('Директор по ИТ'));
  });

  it('CTO и VP of Engineering — разные строки', () => {
    expect(careerRoleRowKey('Chief Technology Officer')).not.toBe(
      careerRoleRowKey('VP of Engineering / Technology'),
    );
  });

  it('разные названия первого лица остаются одной строкой', () => {
    expect(careerRoleRowKey('Технический директор (CTO)')).toBe(careerRoleRowKey('Chief Technology Officer'));
    expect(careerRoleRowKey('Операционный директор')).toBe(careerRoleRowKey('Chief Operating Officer'));
  });

  it('ниже первого лица ключ строки совпадает с ключом роли', () => {
    for (const title of ['Директор по ИТ', 'Head of AI', 'VP of Engineering']) {
      expect(careerRoleRowKey(title)).toBe(careerRoleKey(title));
    }
  });

  it('вакансия CTO по-прежнему относится к роли VP of Engineering: счёт и фильтр не меняются', () => {
    expect(sameCareerRole('Технический директор (CTO)', 'VP of Engineering / Technology')).toBe(true);
  });
});

describe('роли по должностям доходят до «Карьеры» (04.11)', () => {
  const chosen = ['VP of Engineering / Technology', 'Директор по ИТ'];

  it('добавляет CTO и CIO к ролям модели на языке кандидата', () => {
    const named = withPositionRoles({
      named: [{ title: 'Head of AI', reason: 'вёл AI', evidenceRefs: ['memory:2'] }],
      positionRoles: [CTO, CIO],
      chosenTitles: chosen,
      language: 'ru',
    });
    expect(named.map((role) => role.title)).toEqual([
      'Head of AI',
      'Технический директор (CTO)',
      'Директор по информационным технологиям (CIO)',
    ]);
  });

  it('название по-английски, когда язык ролей английский', () => {
    const named = withPositionRoles({ named: [], positionRoles: [CTO], chosenTitles: chosen, language: 'en' });
    expect(named.map((role) => role.title)).toEqual(['Chief Technology Officer']);
  });

  it('название модели не дублируется ролью той же строки', () => {
    const named = withPositionRoles({
      named: [{ title: 'CTO', reason: 'руководил разработкой', evidenceRefs: ['memory:2'] }],
      positionRoles: [CTO],
      chosenTitles: chosen,
      language: 'ru',
    });
    expect(named.map((role) => role.title)).toEqual(['CTO']);
  });

  it('роль другой функции не добавляется: подбор не расширяется', () => {
    const named = withPositionRoles({
      named: [],
      positionRoles: [CTO, auto('VP of Product', 'Вице-президент по продукту', 'vp', 'product')],
      chosenTitles: chosen,
      language: 'ru',
    });
    expect(named.map((role) => role.title)).toEqual(['Технический директор (CTO)']);
  });

  it('роль специалиста и роль без доказательств не добавляются', () => {
    const named = withPositionRoles({
      named: [],
      positionRoles: [
        auto('Solutions Architect', 'Архитектор решений', 'ic', 'eng-mgmt'),
        { ...CIO, evidenceRefs: [] },
      ],
      chosenTitles: chosen,
      language: 'ru',
    });
    expect(named).toEqual([]);
  });

  it('без ролей кандидата и модели ничего не добавляет', () => {
    expect(
      withPositionRoles({ named: [], positionRoles: [CTO], chosenTitles: [], language: 'ru' }),
    ).toEqual([]);
  });

  it('сохранённая роль не выпадает на следующем чтении: список не мигает (04.11)', () => {
    const read = (savedTitles: readonly string[]) =>
      withPositionRoles({
        named: [{ title: 'Директор по ИТ', reason: 'вёл ИТ', evidenceRefs: ['memory:2'] }],
        positionRoles: [CTO, CIO],
        chosenTitles: [...chosen, ...savedTitles],
        language: 'en',
      }).map((role) => role.title);
    const first = read([]);
    expect(first).toEqual(['Директор по ИТ', 'Chief Technology Officer', 'Chief Information Officer']);
    expect(read(first)).toEqual(first);
    expect(read(read(first))).toEqual(first);
  });

  it('не меняет переданные списки', () => {
    const named = Object.freeze([]) as readonly never[];
    const positionRoles = Object.freeze([CTO]);
    expect(() =>
      withPositionRoles({ named, positionRoles, chosenTitles: Object.freeze(chosen), language: 'ru' }),
    ).not.toThrow();
  });
});

describe('добавленные CTO и CIO не меняют подбор кандидата с этими функциями (04.11)', () => {
  const before = ['VP of Engineering / Technology', 'Директор по ИТ', 'Head of AI'];
  const after = [...before, 'Технический директор (CTO)', 'Директор по информационным технологиям (CIO)'];

  it('функции, нижние границы уровня и целевой уровень те же', () => {
    expect(new Set(candidateRoleFunctionCodes(after))).toEqual(new Set(candidateRoleFunctionCodes(before)));
    const level = deriveCandidateTargetLevel({ targetRoles: after, experience: [] });
    expect(level).toBe(deriveCandidateTargetLevel({ targetRoles: before, experience: [] }));
    expect(campaignFunctionLevelFloors(after, level)).toEqual(campaignFunctionLevelFloors(before, level));
  });
});
