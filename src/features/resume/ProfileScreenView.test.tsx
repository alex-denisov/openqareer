import { renderToStaticMarkup } from 'react-dom/server';
import { ProfileDataDialog } from './ProfileDataDialog';
import { describe, expect, it, vi } from 'vitest';
import { ProfileScreenSurface, type ProfileScreenSurfaceProps } from './ProfileScreenView';
import { profileRelocationSummaryStatusFromResponse, ProfileSideRail } from './ProfileSideRail';
import type { RelocationQuestionnaireResponse } from '../relocation/relocationApi';
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
  it('keeps the summary and disabled tabs in place while the content is loading', () => {
    const html = renderToStaticMarkup(<ProfileScreenSurface {...baseProps} loading />);
    expect(html).toContain('Загружаем профиль');
    expect(html).toContain('career-profile-screen-loading-summary');
    expect(html).toContain('career-profile-screen-tabs');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('Марина Соколова');
    expect(html).not.toContain('career-profile-screen-tab-count');
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
    const skillsHtml = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={populatedDraft} tab="skills" />,
    );
    expect(html).toContain('Марина Соколова');
    expect(html).toContain('VP of Engineering');
    expect(html).toContain('FinNova Bank');
    expect(html).toContain('Technical University of Munich');
    expect(html).toContain('Kubernetes');
    expect(html).toContain('career-profile-screen-coverage');
    expect(skillsHtml).toContain('Открыть данные профиля');
    const coursesHtml = renderToStaticMarkup(
      <ProfileDataDialog
        {...baseProps}
        draft={populatedDraft}
        section="courses"
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(coursesHtml).toContain('sec-courses');
    expect(coursesHtml).toContain('Если курсы у вас есть, добавьте их вручную.');
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

  it('retains the complete About source for responsive three-line clamping', () => {
    const longAbout = Array.from({ length: 6 }, (_, i) => `Абзац номер ${i + 1}. `.repeat(20)).join(
      '\n\n',
    );
    const html = renderToStaticMarkup(
      <ProfileScreenSurface
        {...baseProps}
        draft={{ ...populatedDraft, candidate: { ...populatedDraft.candidate, about: longAbout } }}
      />,
    );
    expect(html).toContain('profile-about-text is-clamped');
    const about = html.match(/<section[^>]*id="sec-about"[\s\S]*?<\/section>/u)?.[0] ?? '';
    expect(about).toContain('Абзац номер 6');
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

    const skillsWithoutQuizHandler = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={populatedDraft} tab="skills" />,
    );
    expect(skillsWithoutQuizHandler).toContain('id="profile-panel-skills"');
    expect(skillsWithoutQuizHandler).not.toContain('Пройти квиз по навыкам');
    expect(skillsWithoutQuizHandler).not.toContain('sec-experience');

    const skillsWithQuizHandler = renderToStaticMarkup(
      <ProfileScreenSurface
        {...baseProps}
        draft={populatedDraft}
        tab="skills"
        onOpenSkillQuizBank={() => undefined}
      />,
    );
    expect(skillsWithQuizHandler).toContain('Пройти квиз');
    expect(skillsWithQuizHandler).not.toMatch(/disabled=""[^>]*>[^<]*Пройти квиз/u);
    expect(profileHtml).toContain('career-profile-screen-ats-card');
    expect(profileHtml).toContain('aria-label="Оценка ATS неизвестна"');
    expect(profileHtml).toContain('из 100');
    expect(profileHtml).not.toContain('>JSON<');
  });

  it('shows relocation consent status from the API state and keeps missing state unknown', () => {
    const preparedHtml = renderToStaticMarkup(
      <ProfileSideRail
        draft={populatedDraft}
        desktopLayout
        relocationSummary="prepared"
        onOpenRelocation={() => undefined}
      />,
    );
    const unknownHtml = renderToStaticMarkup(
      <ProfileSideRail draft={populatedDraft} desktopLayout relocationSummary="unknown" />,
    );

    expect(preparedHtml).toContain('Подготовлено');
    expect(preparedHtml).toContain('Видите только вы');
    expect(preparedHtml).toContain('Открыть');
    expect(unknownHtml).toContain('Статус неизвестен');
  });

  it('maps only candidate consent data into relocation status labels', () => {
    const notGranted: RelocationQuestionnaireResponse = {
      profile: null,
      consent: {
        status: 'not_granted',
        granted: false,
        versionId: null,
        grantedAt: null,
        revokedAt: null,
      },
      consentTextStatus: 'pending_dpo_review',
      alerts: [],
    };

    expect(profileRelocationSummaryStatusFromResponse(notGranted)).toBe('prepared');
    expect(
      profileRelocationSummaryStatusFromResponse({
        ...notGranted,
        consent: {
          ...notGranted.consent,
          status: 'revoked',
          revokedAt: '2026-10-17T00:00:00.000Z',
        },
      }),
    ).toBe('not_enabled');
    expect(
      profileRelocationSummaryStatusFromResponse({
        ...notGranted,
        consent: {
          status: 'granted',
          granted: true,
          versionId: 'relocation-v1',
          grantedAt: '2026-10-17T00:00:00.000Z',
          revokedAt: null,
        },
      }),
    ).toBe('enabled');
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
    const skillsHtml = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={draftWithCertsAndLangs} tab="skills" />,
    );

    // Languages: check name and CEFR badge
    expect(html).toContain('Английский');
    expect(html).toContain('Испанский');
    expect(html).toContain('свободный (C1)');
    expect(html).toContain('выше среднего (B2)');

    expect(skillsHtml).toContain('Открыть данные профиля');
    const certificatesHtml = renderToStaticMarkup(
      <ProfileDataDialog
        {...baseProps}
        draft={draftWithCertsAndLangs}
        section="certifications"
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    const coursesHtml = renderToStaticMarkup(
      <ProfileDataDialog
        {...baseProps}
        draft={draftWithCertsAndLangs}
        section="courses"
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(certificatesHtml).toContain('id="sec-certificates"');
    expect(certificatesHtml).toContain('AWS Certified Solutions Architect');
    expect(certificatesHtml).toContain('Amazon Web Services');
    expect(certificatesHtml).not.toContain('Cloud Operations Mastery');
    expect(coursesHtml).toContain('id="sec-courses"');
    expect(coursesHtml).toContain('Cloud Operations Mastery');
    expect(coursesHtml).toContain('Tech Academy');
    expect(coursesHtml).not.toContain('AWS Certified Solutions Architect');
  });
});
