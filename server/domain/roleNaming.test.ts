import { describe, expect, it } from 'vitest';
import { dropOrganisationTitles, roleNamingInstructions } from './roleNaming';

/**
 * PRB-039. Для профиля из LinkedIn модель назвала роли «Accessibility Talent
 * Solutions» и «Marketing Solutions» — это работодатели и продукты кандидата,
 * не должности. Инструкция это запрещает, а код не верит инструкции: роль с
 * названием организации из резюме выбрасывается до экрана.
 */
describe('role naming without organisation names (PRB-039)', () => {
  const organisations = ['Accessibility Talent Solutions', 'LinkedIn · Marketing Solutions'];

  it('drops a role whose title is an employer or a product of the candidate', () => {
    const roles = [
      { title: 'Accessibility Talent Solutions', reason: 'работал там', evidenceRefs: ['memory:1'] },
      { title: 'marketing solutions', reason: 'вёл продукт', evidenceRefs: ['memory:2'] },
      { title: 'Xray Technician', reason: 'семь лет в рентген-кабинете', evidenceRefs: ['memory:3'] },
      { title: 'Solutions Engineer', reason: 'внедрял решения клиентам', evidenceRefs: ['memory:4'] },
    ];
    expect(dropOrganisationTitles(roles, organisations).map((role) => role.title)).toEqual([
      'Xray Technician',
      'Solutions Engineer',
    ]);
  });

  it('keeps every role when the candidate has no organisations on record', () => {
    const roles = [{ title: 'Marketing Solutions', reason: 'r', evidenceRefs: ['memory:1'] }];
    expect(dropOrganisationTitles(roles, [])).toEqual(roles);
  });

  it('tells the model that organisations are not roles and asks for a Russian reason', () => {
    const instructions = roleNamingInstructions('en');
    expect(instructions).toMatch(/компани/iu);
    expect(instructions).toMatch(/не роль/u);
    expect(instructions).toMatch(/Обоснование пиши по-русски/u);
  });
});
