import { describe, expect, it } from 'vitest';
import { campaignFunctionLevelFloors, candidateRoleFunctionCodes } from './candidateRoleFunctions';

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
    expect(floors['consulting']).toBe(0);
    expect(floors['ai-ml']).toBe(0);
  });

  it('в одной функции берёт младшую из её ролей', () => {
    expect(campaignFunctionLevelFloors(['Head of AI', 'AI Consultant'], 'vp')['ai-ml']).toBe(0);
    expect(campaignFunctionLevelFloors(['Head of AI'], 'c-level')['ai-ml']).toBe(2);
  });

  it('без известного уровня кандидата порога нет', () => {
    expect(campaignFunctionLevelFloors(['Head of AI'], undefined)).toEqual({});
  });
});
