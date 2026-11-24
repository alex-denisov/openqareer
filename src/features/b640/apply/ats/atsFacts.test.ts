import { expect, it } from 'vitest';
import { base64Of, factsOf, resumeFileName } from './atsFacts';

it('контакты профиля: имя по частям, LinkedIn ссылкой, город до запятой', () => {
  expect(
    factsOf({
      contact: {
        fullName: 'Марина Соколова',
        email: 'marina@example.com',
        phone: ' +34 600 ',
        location: 'Мадрид, Испания',
        links: ['linkedin.com/in/marina', 'https://marina.example'],
      } as never,
    }),
  ).toMatchObject({
    fullName: 'Марина Соколова',
    firstName: 'Марина',
    lastName: 'Соколова',
    phone: '+34 600',
    linkedin: 'https://linkedin.com/in/marina',
    website: 'https://marina.example',
    city: 'Мадрид',
    country: 'Испания',
  });
});

it('файл резюме: имя без знаков пути, содержимое целиком', () => {
  expect(resumeFileName('A/B\\C', 'pdf')).toBe('A B C.pdf');
  expect(resumeFileName(' ', 'pdf')).toBe('resume.pdf');
  const bytes = new Uint8Array(70_000).map((_, index) => index % 256);
  expect(atob(base64Of(bytes)).length).toBe(70_000);
});
