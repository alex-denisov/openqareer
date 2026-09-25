import { describe, expect, it } from 'vitest';
import { candidateRoleFunctionCodes } from './candidateRoleFunctions';

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
