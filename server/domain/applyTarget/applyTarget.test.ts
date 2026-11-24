import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../unifiedVacancy';
import { applyAddress, atsAddress } from './applyAddress';
import { resolveApplyTarget } from './applyTarget';
import { isSameVacancy } from './sameVacancy';
import { atsInText, emailInText, mailtoOf, telegramInText } from './textTarget';

const UUID = '286059a4-70bc-4128-999a-3873abadde80';
const TEXT = Array.from({ length: 60 }, (_, index) => `слово${index}`).join(' ');

function vacancy(id: string, url: string, over: Partial<UnifiedVacancy> = {}): UnifiedVacancy {
  const [sourceId = '', externalId = ''] = id.split(':');
  return {
    id,
    fingerprint: id,
    title: 'Head of Data',
    company: 'Acme',
    location: 'London, UK',
    description: TEXT,
    requiredSkills: [],
    url,
    publishedAt: '2026-11-17T00:00:00.000Z',
    status: 'active',
    provenance: {
      sourceType: 'json_api',
      sourceId,
      externalId,
      sourceUrl: url,
      observedAt: '2026-11-18T00:00:00.000Z',
    },
    ...over,
  };
}
const indeed = (over: Partial<UnifiedVacancy> = {}) =>
  vacancy('src-indeed:1', 'https://www.indeed.com/viewjob?jk=1', over);
const ashby = (over: Partial<UnifiedVacancy> = {}) =>
  vacancy('ats-ashby-acme:1', `https://jobs.ashbyhq.com/acme/${UUID}?utm_source=x`, over);

describe('адрес площадки отклика', () => {
  it.each([
    ['hh', 'https://spb.hh.ru/vacancy/139218140?from=x', 'https://hh.ru/vacancy/139218140'],
    [
      'linkedin',
      'https://uk.linkedin.com/jobs/view/head-of-data-at-acme-4458720453?x=1',
      'https://www.linkedin.com/jobs/view/4458720453',
    ],
    [
      'greenhouse',
      'https://boards.greenhouse.io/spacex/jobs/8893577002?gh_jid=8893577002',
      'https://boards.greenhouse.io/spacex/jobs/8893577002',
    ],
    [
      'greenhouse',
      'https://job-boards.eu.greenhouse.io/acme/jobs/5',
      'https://job-boards.eu.greenhouse.io/acme/jobs/5',
    ],
    [
      'ashby',
      `https://jobs.ashbyhq.com/acme/${UUID}`,
      `https://jobs.ashbyhq.com/acme/${UUID}/application`,
    ],
    [
      'lever',
      `https://jobs.lever.co/acme/${UUID}?lever-source=Indeed`,
      `https://jobs.lever.co/acme/${UUID}/apply`,
    ],
    [
      'recruitee',
      'https://acme.recruitee.com/o/head-of-data',
      'https://acme.recruitee.com/o/head-of-data/c/new',
    ],
    [
      'teamtailor',
      'https://acme.na.teamtailor.com/jobs/123-head',
      'https://acme.na.teamtailor.com/jobs/123-head/applications/new',
    ],
    [
      'personio',
      'https://acme.jobs.personio.de/job/55?language=en',
      'https://acme.jobs.personio.de/job/55',
    ],
    ['breezy', 'https://acme.breezy.hr/p/abc-head', 'https://acme.breezy.hr/p/abc-head/apply'],
    [
      'bamboohr',
      'https://acme.bamboohr.com/careers/90?source=indeed',
      'https://acme.bamboohr.com/careers/90',
    ],
    [
      'workable',
      'https://apply.workable.com/acme/j/C92802FE06/',
      'https://apply.workable.com/acme/j/C92802FE06/apply/',
    ],
    [
      'smartrecruiters',
      'https://jobs.smartrecruiters.com/acme/744000145449249',
      'https://jobs.smartrecruiters.com/acme/744000145449249',
    ],
    [
      'oracle',
      'https://x.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/213631',
      'https://x.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/213631',
    ],
    [
      'workday',
      'https://a.wd1.myworkdayjobs.com/en-US/Ext/job/London/Head_R1',
      'https://a.wd1.myworkdayjobs.com/en-US/Ext/job/London/Head_R1',
    ],
    [
      'icims',
      'https://careers-a.icims.com/jobs/37138/receptionist/job?x=1',
      'https://careers-a.icims.com/jobs/37138/receptionist/job',
    ],
    ['telegram', 'https://t.me/youritjob/8639', 'https://t.me/youritjob/8639'],
    [
      'board',
      'https://himalayas.app/companies/a/jobs/b',
      'https://himalayas.app/companies/a/jobs/b',
    ],
    [
      'site',
      'https://www.dickssportinggoods.jobs/job/1',
      'https://www.dickssportinggoods.jobs/job/1',
    ],
  ])('%s: %s', (channel, url, form) => {
    expect(applyAddress(url)).toMatchObject({ channel, formUrl: form });
  });

  it('адрес ATS внутри параметра переходника; незнакомый адрес — только у трекера', () => {
    const lever = `https://jobs.lever.co/acme/${UUID}`;
    expect(atsAddress(`https://go.example.com/r?url=${encodeURIComponent(lever)}`)?.url).toBe(
      lever,
    );
    const site = encodeURIComponent('https://careers.acme.com/1');
    expect(atsAddress(`https://jsv3.recruitics.com/redirect?rx_url=${site}`)).toMatchObject({
      channel: 'site',
      url: 'https://careers.acme.com/1',
    });
    expect(atsAddress(`https://go.example.com/r?url=${site}`)).toBeNull();
  });

  it('чужой хост, похожий на площадку, и адрес с логином — не площадка', () => {
    expect(atsAddress(`https://jobs.lever.co.evil.com/acme/${UUID}`)).toBeNull();
    expect(applyAddress(`https://u:p@jobs.lever.co/acme/${UUID}`)).toBeNull();
    expect(applyAddress('javascript:alert(1)')).toBeNull();
  });
});

describe('цель отклика', () => {
  it('gh_jid на сайте работодателя: форма доски источника, без доски — адрес сайта', () => {
    const url = 'https://careers.airbnb.com/positions/7978040?gh_jid=7978040';
    expect(
      resolveApplyTarget({ vacancy: vacancy('ats-greenhouse-airbnb:7978040', url) }),
    ).toMatchObject({
      channel: 'greenhouse',
      formUrl: 'https://job-boards.greenhouse.io/embed/job_app?for=airbnb&token=7978040',
    });
    expect(
      resolveApplyTarget({ vacancy: vacancy('src-company-site-airbnb:7978040', url) }),
    ).toMatchObject({ channel: 'greenhouse', formUrl: url });
  });

  it('та же вакансия у работодателя заменяет агрегатор', () => {
    expect(resolveApplyTarget({ vacancy: indeed(), members: [ashby()] })).toMatchObject({
      channel: 'ashby',
      origin: 'cluster',
    });
  });

  it.each([
    ['другое название', { title: 'Head of Data Platform' }],
    ['другая компания', { company: 'Group 1 Automotive, Inc.' }],
    ['другой город', { location: 'Berlin, DE' }],
    ['другой текст', { description: TEXT.replace(/слово/gu, 'иное') }],
    ['нет текста', { description: 'коротко' }],
    ['снята', { status: 'archived' as const }],
  ])('чужая вакансия склеенного кластера не берётся: %s', (_, over) => {
    expect(resolveApplyTarget({ vacancy: indeed(), members: [ashby(over)] })).toMatchObject({
      channel: 'indeed',
      origin: 'url',
    });
  });

  it('две разные формы у той же вакансии — неясно какая, остаётся площадка', () => {
    const other = ashby({
      id: 'ats-ashby-acme:2',
      url: `https://jobs.ashbyhq.com/acme/${UUID.replace('286', '999')}`,
    });
    expect(resolveApplyTarget({ vacancy: indeed(), members: [ashby(), other] })?.channel).toBe(
      'indeed',
    );
  });

  it('hh.ru той же вакансии — первым (B678)', () => {
    const hh = vacancy('src-hh-search:1', 'https://hh.ru/vacancy/139218140');
    expect(resolveApplyTarget({ vacancy: indeed(), members: [ashby(), hh] })?.channel).toBe('hh');
  });

  it('трекер: до перехода просит его, после — конечная площадка', () => {
    const tracked = indeed({ url: 'https://click.appcast.io/t/abc' });
    expect(resolveApplyTarget({ vacancy: tracked })).toMatchObject({ needsRedirect: true });
    const redirected = () => `https://jobs.lever.co/acme/${UUID}?x=1`;
    expect(resolveApplyTarget({ vacancy: tracked, redirected })).toMatchObject({
      channel: 'lever',
      origin: 'redirect',
    });
    expect(resolveApplyTarget({ vacancy: indeed({ url: 'https://grnh.se/abc' }) })).toMatchObject({
      channel: 'greenhouse',
      needsRedirect: true,
    });
  });

  it('ссылка и почта из текста; две ссылки и сборник вакансий — не цель', () => {
    const link = `https://jobs.ashbyhq.com/acme/${UUID}`;
    const post = (description: string, over: Partial<UnifiedVacancy> = {}) =>
      resolveApplyTarget({
        vacancy: vacancy('src-hn:1', 'https://news.ycombinator.com/item?id=1', {
          description,
          ...over,
        }),
      });
    expect(post(`Apply: ${link}.`)).toMatchObject({ channel: 'ashby', origin: 'text' });
    expect(post(`${link} и ${link.replace('286', '999')}`)).toMatchObject({ channel: 'board' });
    expect(post(`Apply: ${link}`, { postType: 'digest' })).toMatchObject({ channel: 'board' });
    expect(post('Send your resume to hr@acme.com')).toMatchObject({
      channel: 'email',
      formUrl: 'mailto:hr@acme.com',
      email: 'hr@acme.com',
    });
  });
});

describe('контакт в тексте', () => {
  it('почта — только с просьбой прислать отклик', () => {
    expect(emailInText('Резюме присылайте на hr@acme.ru')).toBe('hr@acme.ru');
    expect(emailInText('Email your resume and cover letter to: jobs@acme.com. Note')).toBe(
      'jobs@acme.com',
    );
    expect(
      emailInText('If you require accommodation to apply, email accommodations@acme.com'),
    ).toBeNull();
    expect(
      emailInText('To submit your application with a disability, please contact hr@acme.com'),
    ).toBeNull();
    expect(emailInText('Questions? contact info@acme.com')).toBeNull();
    expect(emailInText('Send CV to a@acme.com or send CV to b@acme.com')).toBeNull();
  });
  it('контакт Telegram — единственный и с просьбой написать', () => {
    expect(telegramInText('Контакт: @Diana_Hantix #serbia')).toBe('https://t.me/diana_hantix');
    expect(telegramInText('Подписывайтесь @channel_news')).toBeNull();
    expect(telegramInText('Пишите на hr@acme.ru')).toBeNull();
  });
});

describe('враждебный текст (проверка безопасности #1186)', () => {
  const SIZE = 200_000;
  const fill = (piece: string) => piece.repeat(Math.ceil(SIZE / piece.length));
  it.each([
    'a',
    'a.',
    '@',
    'a@',
    'a@a.',
    'a@b.co ',
    'send cv to a@b.co ',
    '<',
    '<a ',
    '<a href="',
    '<a href="x">',
    'https://',
    'https://a.co ',
    'https://jobs.lever.co/',
    '.',
    '!',
    ' ',
    '\n',
    'https://a.co/!!!!',
    'пиши @abcdef ',
    'cv ',
    'a-b.c-',
  ])('200 КБ «%s» — меньше 50 мс', (piece) => {
    const text = fill(piece);
    const run = (hostile: string) => {
      const started = performance.now();
      atsInText(hostile);
      emailInText(hostile);
      telegramInText(hostile);
      isSameVacancy(
        vacancy('a:1', 'x', { description: hostile }),
        vacancy('b:1', 'x', { description: hostile }),
      );
      return performance.now() - started;
    };
    [text, `https://a.co/${text}x`, `x@${text}x`].forEach((hostile) => {
      // Лучший из трёх: занятая машина не выдаётся за медленный разбор.
      expect(Math.min(run(hostile), run(hostile), run(hostile))).toBeLessThan(50);
    });
  });

  it('контакт в конце длинного описания не теряется', () => {
    expect(emailInText(`${fill('слово ')}${fill('word ')}. Send your resume to hr@acme.com`)).toBe(
      'hr@acme.com',
    );
  });

  it('почта с % и чужими знаками — не адрес; ссылка письма закодирована', () => {
    expect(emailInText('Send CV to evil%40x.com%2C@acme.com')).toBeNull();
    expect(emailInText('Send CV to a%hr@acme.com')).toBeNull();
    expect(emailInText('Send CV to еhr@acme.com')).toBeNull();
    expect(mailtoOf('a+b@acme.com')).toBe('mailto:a%2Bb@acme.com');
  });
});
