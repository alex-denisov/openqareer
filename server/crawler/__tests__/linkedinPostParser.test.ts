import { describe, expect, it } from 'vitest';
import { parseLinkedinPostCards } from '../linkedinPostParser';

describe('Linkedin post parser (#hiring feed)', () => {
  const sampleEnglishHiringPostHtml = `
    <div class="feed-shared-update-v2" data-urn="urn:li:activity:7123456789012345678">
      <div class="update-components-actor">
        <a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/janedoe?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3A123">
          <span class="update-components-actor__name">Jane Doe</span>
          <span class="update-components-actor__description">Head of Engineering at CloudScale</span>
        </a>
        <span class="update-components-actor__sub-description">2h • Edited</span>
      </div>
      <div class="update-components-text">
        <span class="break-words">
          We are growing rapidly! Looking for a Senior Backend Engineer (Node.js/TypeScript) to join our team at CloudScale.
          100% Remote, competitive salary $140,000 - $180,000 USD.
          If interested, send your CV to jobs@cloudscale.io or DM me directly!
          #hiring #backend #typescript #nodejs #remote
        </span>
      </div>
    </div>
  `;

  const sampleRussianHiringPostHtml = `
    <div class="feed-shared-update-v2" data-urn="urn:li:activity:7987654321098765432">
      <div class="update-components-actor">
        <a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/smirnov-ivan">
          <span class="update-components-actor__name">Иван Смирнов</span>
          <span class="update-components-actor__description">Engineering Lead в FinTech Pro</span>
        </a>
        <span class="update-components-actor__sub-description">5h</span>
      </div>
      <div class="update-components-text">
        <span class="break-words">
          Всем привет! В FinTech Pro открыта вакансия QA Automation Engineer (Python).
          Вилка от 250000 до 350000 руб. Удаленка.
          Пишите в телеграм @smirnov_tech или на почту hr@fintechpro.com
          #hiring #qa #python #вакансия
        </span>
      </div>
    </div>
  `;

  const sampleCandidateLookingForJobHtml = `
    <div class="feed-shared-update-v2" data-urn="urn:li:activity:7111222333444555666">
      <div class="update-components-actor">
        <a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/jobseeker123">
          <span class="update-components-actor__name">Alex Jobseeker</span>
          <span class="update-components-actor__description">Product Manager open for work</span>
        </a>
      </div>
      <div class="update-components-text">
        <span class="break-words">
          I am actively looking for new opportunities as a Senior Product Manager!
          Open to remote roles in EU/US. Reach out if you know any openings.
          #opentowork #jobseeker #lookingforjob
        </span>
      </div>
    </div>
  `;

  const sampleNonHiringDiscussionHtml = `
    <div class="feed-shared-update-v2" data-urn="urn:li:activity:7999888777666555444">
      <div class="update-components-actor">
        <span class="update-components-actor__name">Career Coach</span>
      </div>
      <div class="update-components-text">
        <span class="break-words">
          Here are 5 mistakes candidates make during technical interviews when companies are hiring.
          What is your experience?
          #interview #careers #advice
        </span>
      </div>
    </div>
  `;

  it('parses English #hiring post into a structured UnifiedVacancy', () => {
    const vacancies = parseLinkedinPostCards(sampleEnglishHiringPostHtml, {
      observedAt: '2026-09-15T21:00:00.000Z',
    });

    expect(vacancies).toHaveLength(1);
    const v = vacancies[0];
    expect(v.id).toBe('src-linkedin-posts:urn:li:activity:7123456789012345678');
    expect(v.title).toContain('Senior Backend Engineer');
    expect(v.company).toBe('CloudScale');
    expect(v.isRemote).toBe(true);
    expect(v.salary).toEqual({
      from: 140000,
      to: 180000,
      currency: 'USD',
    });
    expect(v.requiredSkills).toEqual(expect.arrayContaining(['Node.js', 'TypeScript']));
    expect(v.url).toBe('https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/');
    expect(v.contactInfo).toContain('jobs@cloudscale.io');
    expect(v.contactInfo).toContain('https://www.linkedin.com/in/janedoe');
    expect(v.provenance.sourceId).toBe('src-linkedin-posts');
    expect(v.provenance.sourceType).toBe('browser_session');
    expect(v.status).toBe('active');
  });

  it('parses Russian #hiring post into a structured UnifiedVacancy', () => {
    const vacancies = parseLinkedinPostCards(sampleRussianHiringPostHtml, {
      observedAt: '2026-09-15T21:00:00.000Z',
    });

    expect(vacancies).toHaveLength(1);
    const v = vacancies[0];
    expect(v.title).toContain('QA Automation Engineer');
    expect(v.company).toBe('FinTech Pro');
    expect(v.isRemote).toBe(true);
    expect(v.salary).toBeDefined();
    expect(v.salary?.from).toBe(250000);
    expect(v.salary?.to).toBe(350000);
    expect(v.requiredSkills).toEqual(expect.arrayContaining(['QA', 'Python']));
    expect(v.contactInfo).toContain('@smirnov_tech');
    expect(v.contactInfo).toContain('hr@fintechpro.com');
  });

  it('filters out candidate resume / #opentowork posts', () => {
    const vacancies = parseLinkedinPostCards(sampleCandidateLookingForJobHtml, {
      observedAt: '2026-09-15T21:00:00.000Z',
    });

    expect(vacancies).toHaveLength(0);
  });

  it('filters out general discussions without hiring intent', () => {
    const vacancies = parseLinkedinPostCards(sampleNonHiringDiscussionHtml, {
      observedAt: '2026-09-15T21:00:00.000Z',
    });

    expect(vacancies).toHaveLength(0);
  });
});
