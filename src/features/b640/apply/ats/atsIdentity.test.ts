import { describe, expect, it } from 'vitest';
import { identityFact, identityOf, splitName } from './atsIdentity';
import type { AtsField } from './atsFormTypes';
import { consentOption, isCoverLetter, isResumeFile } from './atsFieldPlan';

const field = (label: string, extra: Partial<AtsField> = {}): AtsField => ({
  key: `id:${label}`,
  label,
  kind: 'text',
  role: null,
  required: true,
  options: [],
  accept: null,
  link: null,
  ...extra,
});
const factOf = (label: string, ...others: string[]) =>
  identityFact(field(label), [label, ...others].map((item) => field(item)));

describe('поля о кандидате', () => {
  it.each([
    ['Full name', 'fullName'],
    ['Full Name (as in passport)', 'fullName'],
    ['ФИО', 'fullName'],
    ['Nombre y apellidos', 'fullName'],
    ['Vorname', 'firstName'],
    ['Prénom', 'firstName'],
    ['Imię', 'firstName'],
    ['Legal First Name', 'firstName'],
    ['Nachname', 'lastName'],
    ['Apellidos', 'lastName'],
    ['Cognome', 'lastName'],
    ['E-Mail-Adresse', 'email'],
    ['Correo electrónico', 'email'],
    ['Courriel', 'email'],
    ['Telefonnummer', 'phone'],
    ['Téléphone', 'phone'],
    ['Teléfono', 'phone'],
    ['Phone number', 'phone'],
    ['LinkedIn Profile', 'linkedin'],
    ['LinkedIn-Profil', 'linkedin'],
    ['Perfil de LinkedIn', 'linkedin'],
    ['Wohnort', 'city'],
    ['Ciudad', 'city'],
    ['Miasto', 'city'],
    ['País', 'country'],
  ])('«%s» — %s', (label, fact) => expect(factOf(label)).toBe(fact));

  it('имя одним словом решает соседнее поле', () => {
    expect(factOf('Name')).toBe('fullName');
    expect(factOf('Nome', 'Cognome')).toBe('firstName');
    expect(factOf('Nom', 'Prénom')).toBe('lastName');
    expect(factOf('Имя', 'Фамилия')).toBe('firstName');
    expect(factOf('Имя')).toBe('fullName');
  });

  it('похожее по словам, но не о кандидате, не узнаёт', () => {
    for (const label of [
      'Name of your reference',
      'Имя рекомендателя',
      'Company name',
      'How did you hear about us: LinkedIn?',
      'Did you find us on LinkedIn?',
      'Current city office preference',
    ])
      expect(factOf(label), label).toBeNull();
    expect(identityFact(field('Referee email', { kind: 'email' }), [])).toBeNull();
  });

  it('верит разметке формы на любом языке', () => {
    expect(identityFact(field('名', { autocomplete: 'given-name' }), [])).toBe('firstName');
    expect(identityFact(field('メール', { kind: 'email' }), [])).toBe('email');
    expect(identityFact(field('電話', { autocomplete: 'section-a tel' }), [])).toBe('phone');
  });

  it('у списка берёт только его вариант', () => {
    const options = ['Germany', 'France'].map((label) => ({ value: label[0]!, label }));
    const country = field('Land', { kind: 'select', options });
    expect(identityOf(country, [], { country: 'germany' })).toBe('Germany');
    expect(identityOf(country, [], { country: 'Германия' })).toBeUndefined();
  });

  it('файл резюме и письмо узнаёт на разных языках', () => {
    for (const label of ['Lebenslauf', 'Résumé', 'Currículum', 'Резюме', 'CV'])
      expect(isResumeFile(field(label, { kind: 'file' })), label).toBe(true);
    expect(isResumeFile(field('Portfolio', { kind: 'file' }))).toBe(false);
    expect(isCoverLetter(field('Anschreiben', { kind: 'textarea' }))).toBe(true);
  });

  it('согласие списком — только вопрос о согласии с одним «да»', () => {
    const yesNo = ['Yes', 'No'].map((label) => ({ value: label, label }));
    const ask = (label: string) => consentOption(field(label, { kind: 'radio', options: yesNo }));
    expect(ask('Do you agree to our Privacy Policy?')).toBe('Yes');
    expect(ask('Do you have experience with GDPR?')).toBeNull();
    expect(ask('Can we keep your personal data for future roles and do you agree?')).toBeNull();
  });
});

describe('имя и фамилия', () => {
  it('делит, только когда порядок понятен', () => {
    expect(splitName('Марина Соколова')).toEqual({ firstName: 'Марина', lastName: 'Соколова' });
    expect(splitName('Соколова Марина Ивановна')).toEqual({
      firstName: 'Марина',
      lastName: 'Соколова',
    });
    expect(splitName('Марина Ивановна Соколова')).toEqual({
      firstName: 'Марина',
      lastName: 'Соколова',
    });
    expect(splitName('Anna Maria Lopez')).toEqual({});
    expect(splitName('Cher')).toEqual({});
  });
});
