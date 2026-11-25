import { describe, expect, it } from 'vitest';
import { exactRoleTest } from './matchedFitRelevance';

const ROLES = ['Chief Technology Officer', 'Head of IT Service Management', 'VP of Operations'];

describe('exactRoleTest', () => {
  const exact = exactRoleTest(ROLES);
  it('takes another name of the same top role', () => {
    expect(exact('Технический директор (CTO)')).toBe(true);
    expect(exact('Vice President of Operations')).toBe(true);
  });
  it('does not take a neighbour that only shares the function or two words', () => {
    expect(exact('Руководитель отдела эксплуатации')).toBe(false);
    expect(exactRoleTest(['Head of AI'])('Head of Support')).toBe(false);
  });
  it('keeps the grade and widens only a role the dictionary knows', () => {
    const frontend = exactRoleTest(['Senior Frontend Developer']);
    expect(frontend('Senior Frontend Engineer')).toBe(true);
    expect(frontend('Junior FrontEnd Developer')).toBe(false);
    expect(
      exactRoleTest(['Head of Customer Support'])('Руководитель службы технической поддержки'),
    ).toBe(true);
  });
  it('works for any profession', () => {
    const accountant = exactRoleTest(['Главный бухгалтер']);
    expect(accountant('Главный бухгалтер')).toBe(true);
    expect(accountant('Бухгалтер')).toBe(false);
    const nurse = exactRoleTest(['Старшая медицинская сестра']);
    expect(nurse('Медсестра')).toBe(false);
  });
});
