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
      postUrl: 'https://t.me/devops_jobs/999',
      publishedAt: '2026-08-17T10:00:00.000Z',
      observedAt: '2026-08-18T00:00:00.000Z',
    });

    expect(parsed).toBeNull();
  });
});
