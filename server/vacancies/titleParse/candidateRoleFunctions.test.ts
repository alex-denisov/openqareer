import { describe, expect, it } from 'vitest';
import {
  campaignFunctionLevelFloors,
  campaignLevelFloor,
  campaignLevelMatch,
  campaignLevelWindow,
  candidateRoleFunctionCodes,
  withinCampaignLevels,
} from './candidateRoleFunctions';

describe('candidateRoleFunctionCodes (B267 S3)', () => {
  it('переводит роль кампании в коды функций', () => {
    expect(candidateRoleFunctionCodes(['VP of Technology & Operations'])).toEqual(
      expect.arrayContaining(['ops', 'eng-mgmt']),
    );
  });

  it('не включает общий код other и пустые строки', () => {
    expect(candidateRoleFunctionCodes(['Специалист', '   '])).toEqual([]);
  });

  it('схлопывает повтор функции из разных ролей в один код', () => {
    expect(candidateRoleFunctionCodes(['CTO', 'VP of Engineering'])).toEqual(['eng-mgmt']);
  });
});

describe('campaignFunctionLevelFloors', () => {
  it('роль специалиста не снимает порог уровня с функций других ролей', () => {
    const floors = campaignFunctionLevelFloors(
      ['VP of Engineering / Technology', 'Head of IT Service Management', 'AI Consultant'],
      'vp',
    );
    expect(floors['eng-mgmt']).toBe(2);
    expect(floors['it-ops']).toBe(2);
    expect(floors['consulting']).toBe(2);
    expect(floors['ai-ml']).toBe(2);
  });

  it('в одной функции берёт младшую из её ролей', () => {
    expect(campaignFunctionLevelFloors(['Head of AI', 'Team Lead AI'], 'vp')['ai-ml']).toBe(1);
    expect(campaignFunctionLevelFloors(['Head of AI'], 'c-level')['ai-ml']).toBe(2);
  });

  it('без известного уровня кандидата порога нет', () => {
    expect(campaignFunctionLevelFloors(['Head of AI'], undefined)).toEqual({});
  });
});

describe('роль специалиста в кампании руководителя (04.11)', () => {
  const roles = ['VP of Engineering / Technology', 'Head of Customer Support', 'AI Consultant', 'AI Solutions Architect'];
  const window = campaignLevelWindow(roles, 'vp');
  const row = (title: string, functions: string[], levelRank: number | null) => ({ titleKey: title, functions, levelRank });

  it('не опускает порог ни одной функции', () => {
    expect(window.floors.consulting).toBe(2);
    expect(window.floors.eng).toBe(2);
    expect(window.floors['ai-ml']).toBe(2);
    expect(campaignLevelFloor(roles, 'vp')).toBe(2);
  });

  it('рядовая вакансия той же функции вне окна, а вакансия с названием роли в окне', () => {
    expect(withinCampaignLevels(window, row('software developer', ['eng'], 0))).toBe(false);
    expect(withinCampaignLevels(window, row('консультант 1с', ['consulting', 'it-ops'], 0))).toBe(false);
    expect(withinCampaignLevels(window, row('senior ai consultant', ['ai-ml', 'consulting'], 0))).toBe(true);
  });

  it('роль уровня lead и выше по-прежнему открывает ступени своей функции: отбор и ворота согласны', () => {
    const led = campaignLevelWindow(['Chief Technology Officer', 'Head of AI', 'Support Team Lead'], 'c-level');
    expect(withinCampaignLevels(led, row('head of ml', ['ai-ml'], 2))).toBe(true);
    expect(withinCampaignLevels(led, row('support team lead', ['support'], 1))).toBe(true);
    expect(withinCampaignLevels(led, row('team lead eng', ['eng-mgmt'], 1))).toBe(false);
  });

  it('кандидат-специалист и лид видят свою ступень как раньше', () => {
    expect(campaignFunctionLevelFloors(['Software Engineer'], 'ic').eng).toBe(-1);
    expect(campaignFunctionLevelFloors(['Team Lead', 'Software Engineer'], 'lead').eng).toBe(0);
    expect(campaignLevelWindow(['Software Engineer'], 'ic').specialistTitles).toEqual({});
  });

  it('CIO и ИТ-директор ищут и руководителей ИТ: прежний охват IT Director не теряется', () => {
    expect(campaignFunctionLevelFloors(['IT Director'], 'c-level')['it-ops']).toBe(2);
    expect(campaignFunctionLevelFloors(['Chief Information Officer'], 'c-level')['it-ops']).toBe(2);
    expect(campaignFunctionLevelFloors(['Chief Technology Officer'], 'c-level')['eng-mgmt']).toBe(3);
  });

  it('без известного уровня окно не сужает', () => {
    const open = campaignLevelWindow(['AI Consultant'], undefined);
    expect(withinCampaignLevels(open, row('x', ['eng'], 0))).toBe(true);
  });
});

describe('campaignLevelMatch: ворота и подборка по одному окну', () => {
  const window = campaignLevelWindow(['Chief Technology Officer', 'Head of AI', 'AI Consultant'], 'c-level');
  const verdict = (title: string, functions: string[], levelRank: number | null) =>
    campaignLevelMatch(window, 'c-level', title, { functions, levelRank });

  it('роль кампании не «ниже цели», хотя до неё две ступени', () => {
    expect(verdict('Head of ML', ['ai-ml'], 2)).toBe('match');
    expect(verdict('AI Consultant', ['ai-ml', 'consulting'], 0)).toBe('match');
  });

  it('строка вне окна отвергается', () => {
    expect(verdict('Team Lead C++', ['eng', 'eng-mgmt'], 1)).toBe('below');
    expect(verdict('Software Developer', ['eng'], 0)).toBe('below');
  });

  it('название без разбора судится по самому названию', () => {
    expect(campaignLevelMatch(window, 'c-level', 'Team Lead продаж', undefined)).toBe('below');
    expect(campaignLevelMatch(window, 'c-level', 'Куратор', undefined)).toBe('unknown');
  });
});
