import { describe, expect, it } from 'vitest';
import { parseTelegramJobPost, parseTelegramChannelHtml } from './telegramChannelParser';

describe('Telegram Channel Job Parser', () => {
  const sampleTelegramHtml = `
<div class="tgme_widget_message_wrap">
  <div class="tgme_widget_message" data-post="it_jobs/1234">
    <div class="tgme_widget_message_text js-message_text">
      <b>Senior Backend Developer (Go)</b><br/>
      Компания: <b>Fintech Lab</b><br/>
      Локация: Удалённо / Remote<br/>
      Зарплата: <b>от 350 000 до 500 000 руб. на руки</b><br/><br/>
      Мы разрабатываем ядро платёжной системы. Стек: Go, PostgreSQL, Kafka, Kubernetes.<br/><br/>
      <b>Требования:</b><br/>
      - Опыт разработки на Go от 4 лет<br/>
      - Опыт с микросервисами и highload<br/><br/>
      Контакты: @hr_recruiter
    </div>
    <div class="tgme_widget_message_footer">
      <a class="tgme_widget_message_date" href="https://t.me/it_jobs/1234">
        <time datetime="2026-08-17T15:30:00+00:00">18:30</time>
      </a>
    </div>
  </div>
</div>
  `;

  it('parses a full Telegram channel preview HTML into structured UnifiedVacancy records', () => {
    const vacancies = parseTelegramChannelHtml(sampleTelegramHtml, {
      channelName: 'it_jobs',
      sourceId: 'src-tg-it_jobs',
      observedAt: '2026-08-18T00:00:00.000Z',
    });

    expect(vacancies).toHaveLength(1);
    const job = vacancies[0];
    expect(job.title).toContain('Senior Backend Developer (Go)');
    expect(job.company).toBe('Fintech Lab');
    expect(job.isRemote).toBe(true);
    expect(job.salary?.from).toBe(350000);
    expect(job.salary?.to).toBe(500000);
    expect(job.salary?.currency).toBe('RUR');
    expect(job.requiredSkills).toContain('Go');
    expect(job.requiredSkills).toContain('PostgreSQL');
    expect(job.url).toBe('https://t.me/it_jobs/1234');
    expect(job.provenance.sourceType).toBe('telegram');
    expect(job.qualifications).toBeDefined();
    expect(job.qualifications?.length).toBeGreaterThan(0);
    expect(job.contactInfo).toBe('@hr_recruiter');
  });

  it('extracts salary and remote flags from freeform Russian text', () => {
    const text = 'Ищем Tech Lead (Python). Компания: DataCorp. Зарплата: $5,000 - $7,000. Формат: полная удаленка.';
    const parsed = parseTelegramJobPost(text, {
      postId: '555',
      channelName: 'datacareers',
      sourceId: 'src-tg-datacareers',
      postUrl: 'https://t.me/datacareers/555',
      publishedAt: '2026-08-17T10:00:00.000Z',
      observedAt: '2026-08-18T00:00:00.000Z',
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe('Tech Lead (Python)');
    expect(parsed?.company).toBe('DataCorp');
    expect(parsed?.salary?.from).toBe(5000);
    expect(parsed?.salary?.to).toBe(7000);
    expect(parsed?.salary?.currency).toBe('USD');
    expect(parsed?.isRemote).toBe(true);
    expect(parsed?.experienceLevel).toBe('Lead');
  });

  it('filters out candidate CVs / resume ads and returns null', () => {
    const resumeText = `
#резюме #middle #fullstack
Имя: Александр
Опыт работы: 4 года в разработке
Стек: React, TypeScript, Node.js, PostgreSQL
Ищу работу на полный день, удаленка.
Зарплатные ожидания: от 200 000 руб.
Обо мне: ответственный, пишу чистый код.
Контакты: @alex_dev
    `;

    const parsed = parseTelegramJobPost(resumeText, {
      postId: '1892',
      channelName: 'relocate_today',
      sourceId: 'src-tg-relocate_today',
      postUrl: 'https://t.me/relocate_today/1892',
      publishedAt: '2026-08-17T10:00:00.000Z',
      observedAt: '2026-08-18T00:00:00.000Z',
    });

    expect(parsed).toBeNull();
  });

  it('filters out marketing / course promotional ads and returns null', () => {
    const adText = `
#реклама
Хочешь стать Senior DevOps за 3 месяца?
Записывайтесь на курс по Kubernetes и Terraform!
Скидка 40% по промокоду DEV2026.
Подробнее: https://school.example.com
    `;

    const parsed = parseTelegramJobPost(adText, {
      postId: '999',
      channelName: 'devops_jobs',
      sourceId: 'src-tg-devops_jobs',
      postUrl: 'https://t.me/devops_jobs/999',
      publishedAt: '2026-08-17T10:00:00.000Z',
      observedAt: '2026-08-18T00:00:00.000Z',
    });

    expect(parsed).toBeNull();
  });
});

describe('what the candidate reads from a Telegram post (B164)', () => {
  it('decodes the escapes the channel HTML carries instead of printing them raw', () => {
    const vacancy = parseTelegramJobPost(
      '<b>Product&nbsp;Manager</b><br/>Компания: R&amp;D&nbsp;Lab<br/>' +
        'Ищем менеджера продукта &#8212; удалённо, полная занятость, стек: SQL, Figma.',
      {
        postId: '1',
        channelName: 'product_jobs',
        sourceId: 'src-tg-product',
        postUrl: 'https://t.me/product_jobs/1',
        publishedAt: '2026-08-30T10:00:00.000Z',
        observedAt: '2026-08-30T12:00:00.000Z',
      },
    );
    expect(vacancy).not.toBeNull();
    expect(vacancy?.description).not.toContain('&nbsp;');
    expect(vacancy?.description).not.toContain('&amp;');
    expect(vacancy?.description).not.toContain('&#');
    expect(vacancy?.description).toContain('R&D Lab');
    expect(vacancy?.title).toBe('Product Manager');
  });
});

describe('Telegram posts name the real title and never invent an employer (B164)', () => {
  const meta = {
    postId: '77',
    channelName: 'job_react',
    sourceId: 'src-tg-react',
    postUrl: 'https://t.me/job_react/77',
    publishedAt: '2026-08-30T10:00:00.000Z',
    observedAt: '2026-08-30T12:00:00.000Z',
  };

  it('does not print the hashtag line as the job title', () => {
    const html = [
      '#middle #офис #москва',
      'МТС Банк',
      'Frontend-разработчик',
      'Формат работы: Москва (офис). Ищем Ведущего Web-разработчика в Центр компетенций.',
      'Требования: React, TypeScript, опыт от 3 лет.',
    ].join('<br/>');

    const parsed = parseTelegramJobPost(html, meta);

    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe('Frontend-разработчик');
    expect(parsed?.company).toBe('МТС Банк');
  });

  it('leaves the employer empty when the post never names one', () => {
    const html = [
      'Level Artist / Unity',
      'Ищем Level Artist для участия в разработке кооперативной игры на Unity.',
      'Требования: опыт работы с Unity от двух лет, портфолио уровней.',
    ].join('<br/>');

    const parsed = parseTelegramJobPost(html, meta);

    expect(parsed).not.toBeNull();
    expect(parsed?.company).toBe('');
    expect(parsed?.title).toBe('Level Artist / Unity');
  });

  it('does not turn a post whose role it cannot read into a vacancy (PRB-018)', () => {
    const post = [
      'Доброго времени суток!',
      'Мы небольшая студия, делаем мобильные игры уже семь лет и растём.',
      'Требования: опыт от трёх лет, портфолио, аккуратность.',
      'Условия: удалёнка, гибкий график.',
      'Зарплата: от 200 000 руб. на руки',
      'Контакты: @studio_hr',
    ].join('<br/>');

    const parsed = parseTelegramJobPost(post, {
      postId: '77',
      channelName: 'it_jobs',
      sourceId: 'src-tg-it_jobs',
      postUrl: 'https://t.me/it_jobs/77',
      publishedAt: '2026-09-01T10:00:00+00:00',
      observedAt: '2026-09-01T11:00:00.000Z',
    });

    expect(parsed).toBeNull();
  });
});
