import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { VacancyPitchModal } from './VacancyPitchModal';
import type { VacancyPitchResult } from './vacancyPitchApi';

describe('VacancyPitchModal', () => {
  const sampleVacancy = {
    id: 'vac-101',
    title: 'Lead Frontend Engineer',
    company: 'FinTech Group',
    location: 'Москва',
    isRemote: true,
  };

  const samplePitch: VacancyPitchResult = {
    vacancyId: 'vac-101',
    emailPitch: {
      subject: 'Lead Frontend Engineer — Алексей Денисов | Архитектура и надежность',
      body: 'Здравствуйте!\n\nЗаинтересовала позиция Lead Frontend Engineer в компании FinTech Group.\n\nВ подтверждённом опыте: ускорил рендеринг на 40%.\n\nБуду рад обсудить задачи команды.',
    },
    linkedInNote:
      'Здравствуйте! Заинтересовала позиция Lead Frontend Engineer в FinTech Group. Опыт: ускорил рендеринг на 40%. Рад знакомству!',
    atsCoverLetter:
      'Кому: Нанимающей команде FinTech Group\nПозиция: Lead Frontend Engineer\n\nСопроводительное письмо...',
    usedEvidenceIds: ['mem-01', 'mem-02'],
    generatedAt: '2026-09-17T00:00:00.000Z',
  };

  it('returns null when isOpen is false', () => {
    const html = renderToStaticMarkup(
      <VacancyPitchModal
        isOpen={false}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        initialPitch={samplePitch}
      />,
    );
    expect(html).toBe('');
  });

  it('renders modal with title, format tabs, and tone switchers', () => {
    const html = renderToStaticMarkup(
      <VacancyPitchModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        initialPitch={samplePitch}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="career-pitch-title"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('Lead Frontend Engineer');
    expect(html).toContain('FinTech Group');

    // Format tabs
    expect(html).toContain('Письмо');
    expect(html).toContain('LinkedIn-заметка (300 знаков)');
    expect(html).toContain('Cover letter для ATS');

    // Tone switchers
    expect(html).toContain('Executive');
    expect(html).toContain('Прямой');
    expect(html).toContain('Технический');
    expect(html).toContain('data-pitch-group="tone"');
    expect(html).toContain('data-pitch-group="format"');
    expect(html).toContain('tabindex="-1"');

    // Email pitch content
    expect(html).toContain('Архитектура и надежность');
    expect(html).toContain('Копировать письмо');

    // Evidence counter
    expect(html).toContain('2 факта');
  });

  it('renders LinkedIn note tab with character counter', () => {
    const html = renderToStaticMarkup(
      <VacancyPitchModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        initialPitch={samplePitch}
        initialTab="linkedin"
      />,
    );

    expect(html).toContain('Копировать сообщение');
    expect(html).toContain('из 300');
    expect(html).toContain('Рад знакомству!');
  });

  it('renders outreach button in LinkedIn note tab when onOpenOutreach is passed', () => {
    const html = renderToStaticMarkup(
      <VacancyPitchModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        initialPitch={samplePitch}
        initialTab="linkedin"
        onOpenOutreach={vi.fn()}
      />,
    );

    expect(html).toContain('Кому отправить');
  });

  it('renders ATS cover letter tab with copy and txt download buttons', () => {
    const html = renderToStaticMarkup(
      <VacancyPitchModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        initialPitch={samplePitch}
        initialTab="ats"
      />,
    );

    expect(html).toContain('Копировать текст');
    expect(html).toContain('Скачать .txt');
    expect(html).toContain('Нанимающей команде FinTech Group');
  });

  it('contains zero emoji and zero forbidden word in markup', () => {
    const html = renderToStaticMarkup(
      <VacancyPitchModal
        isOpen={true}
        onClose={vi.fn()}
        vacancy={sampleVacancy}
        initialPitch={samplePitch}
      />,
    );

    // Zero emoji
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);

    // Zero forbidden word
    const forbiddenWord = ['\u0434', '\u043E', '\u0441', '\u044C', '\u0435'].join('');
    expect(html).not.toMatch(new RegExp(forbiddenWord, 'i'));
  });
});

describe('pitch language (B266)', () => {
  it('lets the server detect the language until the candidate picks one', async () => {
    const { executePitchFetch } = await import('./VacancyPitchModal');
    const onFetchPitch = vi.fn(async () => ({}) as VacancyPitchResult);
    await executePitchFetch(
      { id: 'v1', title: 'VP Engineering' },
      'executive',
      undefined,
      onFetchPitch,
    );
    expect(onFetchPitch).toHaveBeenCalledWith('v1', 'executive', undefined);
  });
});
