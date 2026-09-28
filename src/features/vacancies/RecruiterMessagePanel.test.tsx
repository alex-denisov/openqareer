// @vitest-environment jsdom
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RecruiterContact } from '../../../shared/recruiterContact';
import * as vacancyPitchApi from './vacancyPitchApi';
import { RecruiterMessagePanel, resolveContactChannels } from './RecruiterMessagePanel';

describe('RecruiterMessagePanel (C72)', () => {
  const sampleContact: RecruiterContact = {
    id: 'c-1',
    vacancyId: 'vac-101',
    companyName: 'Acme Corp',
    fullName: 'Елена Смирнова',
    roleTitle: 'Technical Recruiter',
    email: 'elena@acme.com',
    emailStatus: 'verified',
    phone: '+7 999 123-45-67',
    telegram: '@elena_recruiter',
    whatsapp: null,
    linkedinUrl: 'https://linkedin.com/in/elena-smirnova',
    githubUrl: null,
    twitterUrl: null,
    sourceType: 'domain_osint',
    confidence: 0.9,
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves primary contact channels for email, telegram, and linkedin', () => {
    const channels = resolveContactChannels(
      sampleContact,
      'Отклик на вакансию',
      'Здравствуйте, Елена!',
    );
    expect(channels.map((c) => c.label)).toEqual(['почте', 'Telegram', 'LinkedIn']);
    expect(channels[0].href).toContain('mailto:elena@acme.com');
    expect(channels[1].href).toBe('https://t.me/elena_recruiter');
    expect(channels[2].href).toBe('https://linkedin.com/in/elena-smirnova');
  });

  it('loads message from vacancyPitchApi and renders under 600 chars with copy and open buttons', async () => {
    const mockPitch: vacancyPitchApi.VacancyPitchResult = {
      vacancyId: 'vac-101',
      emailPitch: { subject: 'Subject', body: 'Body' },
      linkedInNote: 'Note',
      atsCoverLetter: 'ATS',
      contactMessage:
        'Здравствуйте, Елена Смирнова! Меня зовут Алексей Денисов, откликаюсь на Lead Backend Engineer в Acme Corp. Коротко о моём опыте: спроектировал шлюз 15 000 RPS. Буду рад короткому звонку!',
      usedEvidenceIds: ['mem-001'],
      language: 'ru',
      generatedAt: new Date().toISOString(),
    };

    vi.spyOn(vacancyPitchApi, 'requestVacancyPitch').mockResolvedValue(mockPitch);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<RecruiterMessagePanel contact={sampleContact} />);
    });

    // Wait for async effect
    await act(async () => {
      await Promise.resolve();
    });

    expect(vacancyPitchApi.requestVacancyPitch).toHaveBeenCalledWith('vac-101', {
      recipient: {
        name: 'Елена Смирнова',
        role: 'Technical Recruiter',
      },
    });

    const text = container.textContent ?? '';
    expect(text).toContain('Здравствуйте, Елена Смирнова!');
    expect(text).toContain('15 000 RPS');
    expect(text.length).toBeLessThan(600);

    const copyBtn = container.querySelector('.career-recruiter-message-copy-btn');
    expect(copyBtn).not.toBeNull();
    expect(copyBtn?.textContent).toContain('Скопировать');

    const openLinks = container.querySelectorAll('.career-recruiter-message-channel-btn');
    expect(openLinks.length).toBeGreaterThanOrEqual(1);
    const linkTexts = Array.from(openLinks).map((el) => el.textContent);
    expect(linkTexts.some((t) => t?.includes('Открыть в почте'))).toBe(true);
    expect(linkTexts.some((t) => t?.includes('Открыть в Telegram'))).toBe(true);

    act(() => root.unmount());
    container.remove();
  });
});
