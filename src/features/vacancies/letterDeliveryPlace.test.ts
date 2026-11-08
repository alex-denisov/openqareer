import { describe, expect, it } from 'vitest';
import {
  letterRecipientTitle,
  recipientDeliveryPlace,
  vacancyDeliveryChannel,
} from './letterDeliveryPlace';

describe('vacancyDeliveryChannel', () => {
  it.each([
    ['https://hh.ru/vacancy/138670176', 'hh.ru'],
    ['https://job-boards.greenhouse.io/acme/jobs/1', 'ATS Greenhouse'],
    ['https://jobs.lever.co/acme/1', 'ATS Lever'],
    ['https://jobs.ashbyhq.com/acme/1', 'ATS Ashby'],
    ['https://acme.wd1.myworkdayjobs.com/x/job/1', 'ATS Workday'],
    ['https://www.linkedin.com/jobs/view/1', 'LinkedIn'],
    ['https://www.indeed.com/viewjob?jk=1', 'Indeed'],
    ['https://t.me/acme_jobs/15', 'Telegram t.me/acme_jobs'],
    ['https://himalayas.app/companies/rxo/jobs/1', 'Himalayas'],
    ['mailto:jobs@acme.com', 'почту jobs@acme.com'],
    ['https://careers.acme.com/job/1', 'сайт компании careers.acme.com'],
  ])('names %s', (url, channel) => {
    expect(vacancyDeliveryChannel(url)).toBe(channel);
  });

  it.each(['', '   ', 'не адрес'])('does not invent a channel for %j', (url) => {
    expect(vacancyDeliveryChannel(url)).toBeNull();
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

describe('letterRecipientTitle: адресат — компания, площадка только канал (B618)', () => {
  const person = (id: string, extra: object = {}) => ({
    id,
    fullName: 'Мария Орлова',
    roleTitle: null,
    companyName: 'Firstrade',
    ...extra,
  });
  const indeed = 'https://www.indeed.com/viewjob?jk=1';
  const hh = 'https://hh.ru/vacancy/1';
  const company = person('vacancy:1', { fullName: 'Firstrade' });

  it('без человека адресат — компания, а площадка стоит после «через»', () => {
    expect(letterRecipientTitle(3, { path: [company], recipient: company }, 'Firstrade', indeed)).toBe(
      'Кому: Firstrade, через Indeed',
    );
    expect(letterRecipientTitle(3, { path: [company], recipient: company }, 'Firstrade', hh)).toBe(
      'Кому: Firstrade, через hh.ru',
    );
  });

  it('канал неизвестен — так и говорит, адресат всё равно компания', () => {
    expect(letterRecipientTitle(3, { path: [company], recipient: company }, 'Firstrade', '')).toBe(
      'Кому: Firstrade, канал отправки не указан в вакансии',
    );
  });

  it('площадка и ATS никогда не стоят адресатом', () => {
    for (const url of [indeed, hh, 'https://jobs.lever.co/acme/1', 'https://himalayas.app/x']) {
      const title = letterRecipientTitle(3, { path: [company], recipient: company }, 'Firstrade', url);
      expect(title.startsWith('Кому: Firstrade, через ')).toBe(true);
    }
  });

  it('есть человек: «Имя Ф.», компания и канал', () => {
    const recruiter = person('r1', {
      deliveryChannel: { kind: 'email_corporate', value: 'm@acme.com' },
    });
    expect(letterRecipientTitle(3, { path: [], recipient: recruiter }, 'Мария Орлова', hh)).toBe(
      'Кому: Мария О., Firstrade, через почту m@acme.com',
    );
    expect(letterRecipientTitle(3, { path: [], recipient: person('r2') }, 'Мария Орлова', hh)).toBe(
      'Кому: Мария О., Firstrade, через hh.ru',
    );
  });

  it('у человека без компании компания не выдумывается', () => {
    const noCompany = person('r3', { companyName: null, deliveryChannel: { kind: 'telegram', value: '@maria' } });
    expect(letterRecipientTitle(3, { path: [], recipient: noCompany }, 'Мария Орлова', hh)).toBe(
      'Кому: Мария О., через Telegram @maria',
    );
  });

  it('знакомому не пишем через страницу вакансии', () => {
    expect(letterRecipientTitle(1, { path: [], recipient: person('c1') }, 'Мария Орлова', hh)).toBe(
      'Кому: Мария О., Firstrade, канал не указан',
    );
  });

  it('Круг 2 «Через кого» не меняется', () => {
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
