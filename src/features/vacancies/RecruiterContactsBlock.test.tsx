import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RecruiterContact } from '../../../shared/recruiterContact';
import { RecruiterContactsBlock } from './RecruiterContactsBlock';

describe('RecruiterContactsBlock', () => {
  const sampleContact: RecruiterContact = {
    id: 'c-1',
    vacancyId: 'vac-1',
    companyName: 'Acme Corp',
    fullName: 'Елена Смирнова',
    roleTitle: 'Technical Recruiter',
    email: 'elena.smirnova@acmecorp.com',
    emailStatus: 'verified',
    phone: '+7 999 123-45-67',
    telegram: '@elena_recruiter',
    whatsapp: 'https://wa.me/79991234567',
    linkedinUrl: 'https://www.linkedin.com/in/elena-smirnova',
    githubUrl: null,
    twitterUrl: null,
    sourceType: 'domain_osint',
    confidence: 0.95,
    createdAt: '2026-09-17T10:00:00.000Z',
    updatedAt: '2026-09-17T10:00:00.000Z',
  };

  const hypothesisContact: RecruiterContact = {
    ...sampleContact,
    id: 'c-2',
    fullName: 'Михаил Ковалев',
    roleTitle: 'Engineering Manager',
    email: 'm.kovalev@acmecorp.com',
    emailStatus: 'hypothesis',
    phone: null,
    telegram: null,
    whatsapp: null,
    linkedinUrl: null,
    githubUrl: 'https://github.com/mkovalev',
  };

  it('отображает кнопку «Рекрутер» с тултипом, если контакты ещё не искались (B236 §4.4)', () => {
    const html = renderToStaticMarkup(
      <RecruiterContactsBlock vacancyId="vac-1" />,
    );
    expect(html).toContain('>Рекрутер<');
    expect(html).toContain('Найти того, кто ведёт вакансию');
    expect(html).not.toContain('Найти прямые контакты');
  });

  it('отображает карточку контакта и бейдж «Почта проверена» — бейдж про адрес, не про человека', () => {
    const html = renderToStaticMarkup(
      <RecruiterContactsBlock vacancyId="vac-1" initialContacts={[sampleContact]} />,
    );
    expect(html).toContain('Елена Смирнова');
    expect(html).toContain('Technical Recruiter');
    expect(html).toContain('Почта проверена');
    expect(html).toContain('Адрес подтверждён почтовым сервером');
  });

  it('отображает бейдж «Почта — гипотеза» для предположительного контакта', () => {
    const html = renderToStaticMarkup(
      <RecruiterContactsBlock vacancyId="vac-1" initialContacts={[hypothesisContact]} />,
    );
    expect(html).toContain('Михаил Ковалев');
    expect(html).toContain('Engineering Manager');
    expect(html).toContain('Почта — гипотеза');
    expect(html).toContain('может не существовать');
    expect(html).toContain('https://github.com/mkovalev');
  });

  it('отображает каналы связи: mailto, telegram, whatsapp, телефон, linkedin', () => {
    const html = renderToStaticMarkup(
      <RecruiterContactsBlock vacancyId="vac-1" initialContacts={[sampleContact]} />,
    );
    expect(html).toContain('mailto:elena.smirnova@acmecorp.com');
    expect(html).toContain('https://t.me/elena_recruiter');
    expect(html).toContain('https://wa.me/79991234567');
    expect(html).toContain('tel:+79991234567');
    expect(html).toContain('https://www.linkedin.com/in/elena-smirnova');
  });

  it('отображает сообщение когда открытые контакты не найдены', () => {
    const html = renderToStaticMarkup(
      <RecruiterContactsBlock vacancyId="vac-1" initialContacts={[]} searched={true} />,
    );
    expect(html).toContain('Рекрутер или hiring manager в открытых источниках не нашлись');
    expect(html).toContain('Искать ещё раз');
    expect(html).not.toContain('Прямые контакты');
  });
});
