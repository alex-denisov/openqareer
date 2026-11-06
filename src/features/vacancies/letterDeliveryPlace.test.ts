import { describe, expect, it } from 'vitest';
import {
  letterRecipientTitle,
  recipientDeliveryPlace,
  vacancyDeliveryPlace,
} from './letterDeliveryPlace';

describe('vacancyDeliveryPlace', () => {
  it.each([
    ['https://hh.ru/vacancy/138670176', 'hh.ru, отклик на вакансию'],
    ['https://job-boards.greenhouse.io/acme/jobs/1', 'ATS Greenhouse'],
    ['https://jobs.lever.co/acme/1', 'ATS Lever'],
    ['https://jobs.ashbyhq.com/acme/1', 'ATS Ashby'],
    ['https://acme.wd1.myworkdayjobs.com/x/job/1', 'ATS Workday'],
    ['https://www.linkedin.com/jobs/view/1', 'LinkedIn, страница вакансии'],
    ['https://t.me/acme_jobs/15', 'Telegram, t.me/acme_jobs'],
    ['https://himalayas.app/companies/rxo/jobs/1', 'Himalayas, страница вакансии'],
    ['mailto:jobs@acme.com', 'почта jobs@acme.com'],
    ['https://careers.acme.com/job/1', 'сайт компании, careers.acme.com'],
  ])('names %s', (url, place) => {
    expect(vacancyDeliveryPlace(url)).toBe(place);
  });

  it.each(['', '   ', 'не адрес'])('does not invent a place for %j', (url) => {
    expect(vacancyDeliveryPlace(url)).toBeNull();
  });
});

describe('recipientDeliveryPlace', () => {
  it('names the confirmed channel of the person', () => {
    expect(
      recipientDeliveryPlace({ deliveryChannel: { kind: 'email_corporate', value: 'm@acme.com' } }),
    ).toBe('почта m@acme.com');
    expect(recipientDeliveryPlace({ deliveryChannel: { kind: 'telegram', value: '@maria' } })).toBe(
      'Telegram @maria',
    );
  });

  it('falls back to LinkedIn only when the profile is known', () => {
    expect(recipientDeliveryPlace({ linkedinUrl: 'https://linkedin.com/in/maria' })).toBe(
      'LinkedIn',
    );
    expect(recipientDeliveryPlace({ linkedinUrl: null })).toBeNull();
    expect(recipientDeliveryPlace({})).toBeNull();
  });
});

describe('letterRecipientTitle', () => {
  const person = (id: string, extra: object = {}) => ({
    id,
    fullName: 'Мария Орлова',
    roleTitle: null,
    companyName: null,
    ...extra,
  });
  const hh = 'https://hh.ru/vacancy/1';

  it('puts the channel in place of an absent person', () => {
    const company = person('vacancy:1');
    expect(letterRecipientTitle(3, { path: [company], recipient: company }, 'RXO', hh)).toBe(
      'Кому: hh.ru, отклик на вакансию',
    );
    expect(letterRecipientTitle(3, { path: [company], recipient: company }, 'RXO', '')).toBe(
      'Кому: RXO, канал отправки не указан в вакансии',
    );
  });

  it('names the person and where the letter goes', () => {
    const recruiter = person('r1', {
      deliveryChannel: { kind: 'email_corporate', value: 'm@acme.com' },
    });
    expect(letterRecipientTitle(3, { path: [], recipient: recruiter }, 'Мария Орлова', hh)).toBe(
      'Кому: Мария Орлова, почта m@acme.com',
    );
    expect(letterRecipientTitle(3, { path: [], recipient: person('r2') }, 'Мария Орлова', hh)).toBe(
      'Кому: Мария Орлова, hh.ru, отклик на вакансию',
    );
  });

  it('does not send a letter to a contact through the vacancy page', () => {
    expect(letterRecipientTitle(1, { path: [], recipient: person('c1') }, 'Мария Орлова', hh)).toBe(
      'Кому: Мария Орлова, канал не указан',
    );
  });

  it('asks through the first person on the path', () => {
    const friend = person('c2', { linkedinUrl: 'https://linkedin.com/in/x' });
    const me = person('me');
    expect(
      letterRecipientTitle(
        2,
        { path: [me, friend, person('r')], recipient: person('r') },
        'А → Б',
        hh,
      ),
    ).toBe('Через кого: А → Б, LinkedIn');
  });
});
