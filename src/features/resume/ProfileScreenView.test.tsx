import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProfileScreenSurface, type ProfileScreenSurfaceProps } from './ProfileScreenView';
import type { ResumeDraft } from './resumeTypes';

const baseProps: ProfileScreenSurfaceProps = {
  candidateId: 'cand-1',
  memory: [],
  onRetry: () => undefined,
  onDraftChange: () => undefined,
  onSectionSave: () => undefined,
  onConfirmOpenToWork: () => undefined,
};

const populatedDraft: ResumeDraft = {
  schemaVersion: 2,
  candidate: {
    fullName: 'Марина Соколова',
    headline: 'VP of Engineering',
    contact: { email: 'm@example.com', location: 'Берлин, Германия' },
  },
  experience: [
    {
      id: 'exp-1',
      chronologyMemoryId: 'mem-exp-1',
      title: 'VP of Engineering',
      employer: 'FinNova Bank',
      startDate: '2023-01',
      current: true,
      bulletMemoryIds: [],
    },
  ],
  education: [
    {
      id: 'edu-1',
      evidenceMemoryId: 'mem-edu-1',
      institution: 'Technical University of Munich',
      qualification: 'MSc Computer Science',
    },
  ],
  skills: [{ id: 'skill-1', name: 'Kubernetes' }],
  languages: [{ id: 'lang-1', evidenceMemoryId: 'mem-lang-1', name: 'Английский', cefr: 'C1' }],
};

describe('ProfileScreenSurface — states', () => {
  it('shows a loading state and no sections while the draft has not arrived', () => {
    const html = renderToStaticMarkup(<ProfileScreenSurface {...baseProps} loading />);
    expect(html).toContain('Загружаем профиль');
    expect(html).not.toContain('career-profile-screen-topcard');
  });

  it('shows a retry action on error, never a blank screen', () => {
    const onRetry = vi.fn();
    const html = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} error="Сеть недоступна" onRetry={onRetry} />,
    );
    expect(html).toContain('Сеть недоступна');
    expect(html).toContain('Повторить');
  });

  it('shows an honest empty state for a brand-new candidate', () => {
    const html = renderToStaticMarkup(
      <ProfileScreenSurface
        {...baseProps}
        draft={{ candidate: {}, experience: [], education: [], languages: [] }}
      />,
    );
    expect(html).toContain('Профиль пока пуст');
  });

  it('renders every section anchor and the source-coverage side rail once the draft is populated', () => {
    const html = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={populatedDraft} />,
    );
    expect(html).toContain('Марина Соколова');
    expect(html).toContain('VP of Engineering');
    expect(html).toContain('FinNova Bank');
    expect(html).toContain('Technical University of Munich');
    expect(html).toContain('Kubernetes');
    expect(html).toContain('sec-courses');
    expect(html).toContain('Раздел действительно пуст в источнике');
    expect(html).toContain('career-profile-screen-coverage');
  });

  it('surfaces a save error next to the save action without hiding the document', () => {
    const html = renderToStaticMarkup(
      <ProfileScreenSurface
        {...baseProps}
        draft={populatedDraft}
        saveError="Не удалось сохранить"
      />,
    );
    expect(html).toContain('Не удалось сохранить');
    expect(html).toContain('career-profile-screen-topcard');
  });

  it('renders long "about" text across paragraphs without truncating it', () => {
    const longAbout = Array.from({ length: 6 }, (_, i) => `Абзац номер ${i + 1}. `.repeat(20)).join(
      '\n\n',
    );
    const html = renderToStaticMarkup(
      <ProfileScreenSurface
        {...baseProps}
        draft={{ ...populatedDraft, candidate: { ...populatedDraft.candidate, about: longAbout } }}
      />,
    );
    expect(html).toContain('Абзац номер 6');
  });

  // Owner remark #6: a heading paragraph followed by "- bullet" lines must
  // render as a paragraph plus a real <ul>, not one run-on sentence.
  it('renders "about" bullet lines as a bulleted list, not glued onto the previous sentence', () => {
    const about = 'Что делаю лучше всего:\n- Строю инженерную стратегию\n- Масштабирую команды';
    const html = renderToStaticMarkup(
      <ProfileScreenSurface
        {...baseProps}
        draft={{ ...populatedDraft, candidate: { ...populatedDraft.candidate, about } }}
      />,
    );
    expect(html).not.toContain('Что делаю лучше всего: - Строю');
    expect(html).toMatch(/<ul>.*Строю инженерную стратегию.*<\/ul>/);
    expect(html).toContain('<li>Строю инженерную стратегию</li>');
    expect(html).toContain('<li>Масштабирую команды</li>');
  });

  it('renders responsibility bullets under a position from bulletMemoryIds and the language source line', () => {
    const draft: ResumeDraft = {
      ...populatedDraft,
      experience: [
        {
          ...populatedDraft.experience[0],
          bulletMemoryIds: ['mem-resp-1'],
        },
      ],
      languages: [
        {
          id: 'lang-1',
          evidenceMemoryId: 'mem-lang-1',
          name: 'Английский',
          cefr: 'C1',
          sourceLabel: 'Full professional proficiency',
        },
      ],
    };
    const html = renderToStaticMarkup(
      <ProfileScreenSurface
        {...baseProps}
        draft={draft}
        memory={[
          {
            id: 'mem-resp-1',
            kind: 'fact',
            domain: 'responsibility',
            statement: 'Отвечал за платёжную стратегию для 6 продуктовых команд.',
            confidence: 'candidate-confirmed',
            sourceMessageIds: [],
            sensitive: false,
            status: 'confirmed',
          },
        ]}
      />,
    );
    expect(html).toContain('career-profile-screen-position-bullets');
    expect(html).toContain('Отвечал за платёжную стратегию для 6 продуктовых команд.');
    expect(html).toContain('career-profile-screen-lang-source');
    expect(html).toContain('Full professional proficiency');
  });

  it('gives every section a working pencil (owner remark #7)', () => {
    const html = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={populatedDraft} />,
    );
    expect(html).toContain('Изменить «Обо мне»');
    expect(html).toContain('Изменить должность');
    expect(html).toContain('Изменить образование');
    expect(html).toContain('Изменить навыки');
  });

  // The "Профиль / Документ и форматы" tabs now live in the cabinet shell's
  // page header, beside the «Профиль» title, not in this surface (B265
  // review round 3) — the surface only reads the controlled `tab` prop.
  it('never renders a permanent Save button, and switches to the document menu on the "documents" tab', () => {
    const profileHtml = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={populatedDraft} tab="profile" />,
    );
    expect(profileHtml).not.toContain('>Сохранить<');
    expect(profileHtml).not.toContain('career-profile-screen-tabs');
    expect(profileHtml).toContain('sec-experience');

    const documentsHtml = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={populatedDraft} tab="documents" />,
    );
    expect(documentsHtml).not.toContain('sec-experience');
  });

  // Owner acceptance 2026-09-25: the self-audit view was orphaned behind a
  // dead host after B248 — it must reach the candidate through the profile
  // screen's own tab row, not a screen nobody renders.
  it('switches to the self-audit view on the "audit" tab', () => {
    const auditHtml = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={populatedDraft} tab="audit" candidateId="cand-1" />,
    );
    expect(auditHtml).not.toContain('sec-experience');
    expect(auditHtml).toContain('career-reputation-surface');
  });
});
