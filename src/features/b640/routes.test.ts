import { describe, expect, it } from 'vitest';
import {
  B640_NODES,
  B640_SECTIONS,
  B640_TAB_SETS,
  buildNodePath,
  crumbTrail,
  matchNode,
  nodeByCode,
} from './routes';

function samplePath(path: string): string {
  return path.replace(/:[A-Za-z]+/gu, 'x1');
}

describe('адреса узлов нового кабинета (B649)', () => {
  it('описывает 72 узла карты без повторов кода и адреса', () => {
    expect(B640_NODES).toHaveLength(72);
    expect(new Set(B640_NODES.map((node) => node.code)).size).toBe(72);
    expect(new Set(B640_NODES.map((node) => node.path)).size).toBe(72);
    expect(new Set(B640_NODES.map((node) => node.slug)).size).toBe(72);
  });

  it('раскладывает узлы по 15 разделам, в каждом есть узел', () => {
    expect(B640_SECTIONS).toHaveLength(15);
    for (const section of B640_SECTIONS) {
      expect(B640_NODES.some((node) => node.section === section), section).toBe(true);
    }
  });

  it('каждый узел открывается по своему адресу', () => {
    for (const node of B640_NODES) {
      const match = matchNode(samplePath(node.path));
      expect(match?.node.code, node.path).toBe(node.code);
    }
  });

  it('понимает корень, хвостовую косую черту и параметры', () => {
    expect(matchNode('/app')?.node.code).toBe('s03');
    expect(matchNode('/app/')?.node.code).toBe('s03');
    expect(matchNode('/app/profile/')?.node.code).toBe('s01');
    expect(matchNode('/app/vacancies/saved')?.node.code).toBe('v06s');
    const vacancy = matchNode('/app/vacancies/abc-42');
    expect(vacancy?.node.code).toBe('v04');
    expect(vacancy?.params).toEqual({ vacancyId: 'abc-42' });
    expect(matchNode('/app/responses/r7/interview/mock')?.params).toEqual({ responseId: 'r7' });
  });

  it('при равном числе точных звеньев побеждает адрес с точным звеном левее', () => {
    expect(matchNode('/app/responses/offers/letter')?.node.code).toBe('o06a');
    expect(matchNode('/app/responses/offers/interview')?.node.code).toBe('o06a');
    expect(matchNode('/app/responses/r7/letter')?.node.code).toBe('o02');
    expect(matchNode('/app/diary/goals/new')?.node.code).toBe('d02b');
    expect(matchNode('/app/diary/goals/g1')?.node.code).toBe('d02a');
  });

  it('не узнаёт чужие адреса', () => {
    expect(matchNode('/app/nope')).toBeNull();
    expect(matchNode('/app/profile/status/extra')).toBeNull();
    expect(matchNode('/login')).toBeNull();
  });

  it('собирает адрес узла с параметрами и не отдаёт адрес без них', () => {
    expect(buildNodePath('s01')).toBe('/app/profile');
    expect(buildNodePath('v04', { vacancyId: 'a b' })).toBe('/app/vacancies/a%20b');
    expect(() => buildNodePath('v04')).toThrow();
  });

  it('у вложенного узла есть путь назад до корня раздела', () => {
    for (const node of B640_NODES) {
      if (node.parent) expect(nodeByCode(node.parent), `${node.code} → ${node.parent}`).toBeDefined();
    }
    expect(crumbTrail('p07').map((node) => node.code)).toEqual(['s01', 'p06', 'p07']);
    expect(crumbTrail('s03').map((node) => node.code)).toEqual(['s03']);
    expect(crumbTrail('d02l').map((node) => node.code)).toEqual(['d00', 'd02', 'd02k', 'd02l']);
  });

  it('вкладки разделов ведут на существующие узлы', () => {
    for (const [id, tabSet] of Object.entries(B640_TAB_SETS)) {
      expect(tabSet.tabs.length, id).toBeGreaterThan(1);
      for (const tab of tabSet.tabs) expect(nodeByCode(tab.code), `${id}: ${tab.label}`).toBeDefined();
    }
    expect(B640_TAB_SETS.profile.tabs.map((tab) => tab.label)).toEqual([
      'Опыт',
      'Цифровой след',
      'LinkedIn',
      'hh.ru',
      'Контакты',
      'Журнал',
      'История изменений',
    ]);
  });
});
