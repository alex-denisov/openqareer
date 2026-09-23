import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProfileScreenSurface, type ProfileScreenSurfaceProps } from './ProfileScreenView';
import type { ResumeDraft } from './resumeTypes';

const baseProps: ProfileScreenSurfaceProps = {
  candidateId: 'cand-1',
  memory: [],
  onRetry: () => undefined,
  onDraftChange: () => undefined,
  onSave: () => undefined,
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
    expect(html).not.toContain('career-profile-topcard');
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
    const html = renderToStaticMarkup(<ProfileScreenSurface {...baseProps} draft={populatedDraft} />);
    expect(html).toContain('Марина Соколова');
    expect(html).toContain('VP of Engineering');
    expect(html).toContain('FinNova Bank');
    expect(html).toContain('Technical University of Munich');
    expect(html).toContain('Kubernetes');
    expect(html).toContain('sec-courses');
    expect(html).toContain('Раздел действительно пуст в источнике');
    expect(html).toContain('career-profile-coverage');
  });

  it('surfaces a save error next to the save action without hiding the document', () => {
    const html = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={populatedDraft} saveError="Не удалось сохранить" />,
    );
    expect(html).toContain('Не удалось сохранить');
    expect(html).toContain('career-profile-topcard');
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
});
