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
  onOpenExpert: () => undefined,
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
    expect(html).toContain('Если курсы у вас есть, добавьте их вручную.');
    expect(html).toContain('career-profile-screen-coverage');
  });

  it('names a model reader and leaves an older import without an unverified claim (B184)', () => {
    const modelHtml = renderToStaticMarkup(
      <ProfileScreenSurface
        {...baseProps}
        draft={populatedDraft}
        view={
          {
            reader: {
              method: 'model',
              model: 'openai:gpt-5.6-mini',
              promptRevision: 'resume-structuring-v1',
              readAt: '2026-09-26T10:00:00.000Z',
            },
          } as never
        }
      />,
    );
    const unknownHtml = renderToStaticMarkup(
      <ProfileScreenSurface
        {...baseProps}
        draft={populatedDraft}
        view={{ reader: null } as never}
      />,
    );

    expect(modelHtml).toContain('Прочитано моделью');
    expect(unknownHtml).not.toContain('Прочитано');
    expect(unknownHtml).not.toContain('Резюме прочитано: неизвестно');
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

  it('shows a short "about" excerpt and an expansion action for longer text', () => {
    const longAbout = Array.from({ length: 6 }, (_, i) => `Абзац номер ${i + 1}. `.repeat(20)).join(
      '\n\n',
    );
    const html = renderToStaticMarkup(
      <ProfileScreenSurface
        {...baseProps}
        draft={{ ...populatedDraft, candidate: { ...populatedDraft.candidate, about: longAbout } }}
      />,
    );
    expect(html).toContain('Показать полностью');
    const about = html.match(/<section[^>]*id="sec-about"[\s\S]*?<\/section>/u)?.[0] ?? '';
    expect(about).not.toContain('Абзац номер 6');
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
    expect(html).toContain('Источник: импортированный профиль');
    expect(html).not.toContain('Full professional proficiency');
  });

  it('keeps section editing actions available on their profile tabs', () => {
    const html = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={populatedDraft} />,
    );
    expect(html).toContain('Изменить «Обо мне»');
    expect(html).toContain('Изменить образование');
    expect(html).toContain('Редактировать место целиком: FinNova Bank');
    const skillsHtml = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={populatedDraft} tab="skills" />,
    );
    expect(skillsHtml).toContain('Изменить навыки');
  });

  it('renders three controlled tabs with matching panels and no permanent Save button', () => {
    const profileHtml = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={populatedDraft} />,
    );
    expect(profileHtml).not.toContain('>Сохранить<');
    expect(profileHtml).toContain('role="tablist"');
    expect(profileHtml).toContain('id="profile-panel-resume"');
    expect(profileHtml).toContain('sec-experience');

    const skillsHtml = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={populatedDraft} tab="skills" />,
    );
    expect(skillsHtml).toContain('id="profile-panel-skills"');
    expect(skillsHtml).not.toContain('sec-experience');
    expect(skillsHtml).toContain('Пройти квиз по навыкам');
    expect(profileHtml).toContain('career-profile-screen-ats-card');
    expect(profileHtml).toContain('Не рассчитано');
    expect(profileHtml).not.toContain('>JSON<');
  });

  it('switches to the digital footprint audit on the trace tab', () => {
    const auditHtml = renderToStaticMarkup(
      <ProfileScreenSurface
        {...baseProps}
        draft={populatedDraft}
        tab="trace"
        candidateId="cand-1"
      />,
    );
    expect(auditHtml).not.toContain('sec-experience');
    expect(auditHtml).toContain('id="profile-panel-trace"');
    expect(auditHtml).toContain('career-footprint');
  });

  it('renders localized language levels and certifications separate from courses (B265)', () => {
    const draftWithCertsAndLangs: ResumeDraft = {
      ...populatedDraft,
      languages: [
        {
          id: 'lang-1',
          evidenceMemoryId: 'mem-lang-1',
          name: 'English',
          cefr: 'C1',
          sourceLabel: 'Full professional proficiency',
        },
        {
          id: 'lang-2',
          evidenceMemoryId: 'mem-lang-2',
          name: 'Spanish',
          cefr: 'B2',
          sourceLabel: 'Professional working proficiency',
        },
      ],
      certifications: [
        {
          id: 'cert-1',
          name: 'AWS Certified Solutions Architect',
          issuer: 'Amazon Web Services',
          issuedAt: '2023',
        },
      ],
      courses: [
        {
          id: 'course-1',
          name: 'Cloud Operations Mastery',
          institution: 'Tech Academy',
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={draftWithCertsAndLangs} />,
    );

    // Languages: check name and CEFR badge
    expect(html).toContain('Английский');
    expect(html).toContain('Испанский');
    expect(html).toContain('свободный (C1)');
    expect(html).toContain('выше среднего (B2)');

    // Certifications: separate section with id="sec-certificates"
    expect(html).toContain('id="sec-certificates"');
    expect(html).toContain('AWS Certified Solutions Architect');
    expect(html).toContain('Amazon Web Services');

    // Courses: separate section with id="sec-courses"
    expect(html).toContain('id="sec-courses"');
    expect(html).toContain('Cloud Operations Mastery');
    expect(html).toContain('Tech Academy');
  });
});
