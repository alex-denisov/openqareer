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

  it('показывает честную подпись источника из LinkedIn без стрелки и без повторения уровня', () => {
    const html = renderToStaticMarkup(
      <ProfileLanguagesSection draft={baseDraft} onSectionSave={() => undefined} />,
    );
    expect(html).toContain('Из LinkedIn: Full professional proficiency');
    expect(html).not.toContain('LinkedIn: «Full professional proficiency» → C1');
  });

  it('показывает «Указано вами» для языка без источника LinkedIn', () => {
    const html = renderToStaticMarkup(
      <ProfileLanguagesSection draft={baseDraft} onSectionSave={() => undefined} />,
    );
    expect(html).toContain('Указано вами');
  });
});
