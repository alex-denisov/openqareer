import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProfileLanguagesSection } from './ProfileLanguagesSection';
import type { ResumeDraft } from './resumeTypes';

describe('ProfileLanguagesSection', () => {
  const baseDraft: ResumeDraft = {
    candidate: { fullName: 'Алексей Денисов' },
    targetRole: 'Руководитель продукта',
    experience: [],
    education: [],
    languages: [
      {
        id: 'lang-1',
        evidenceMemoryId: 'mem-1',
        name: 'English',
        cefr: 'C1',
        sourceLabel: 'Full professional proficiency',
      },
      {
        id: 'lang-2',
        evidenceMemoryId: 'mem-2',
        name: 'Русский',
        cefr: 'C2',
      },
    ],
  };

  it('показывает уровень словом и шкалу из пяти делений без англоязычной приписки', () => {
    const html = renderToStaticMarkup(
      <ProfileLanguagesSection draft={baseDraft} onSectionSave={() => undefined} />,
    );
    expect(html).toContain('Английский — свободный (C1)');
    expect(html.match(/career-profile-screen-lang-meter/g)).toHaveLength(2);
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(5);
    expect(html).toContain('Источник: импортированный профиль');
    expect(html).not.toContain('Full professional proficiency');
  });

  it('показывает «Указано вами» для языка без источника LinkedIn', () => {
    const html = renderToStaticMarkup(
      <ProfileLanguagesSection draft={baseDraft} onSectionSave={() => undefined} />,
    );
    expect(html).toContain('Указано вами');
  });
});
