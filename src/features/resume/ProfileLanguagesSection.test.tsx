import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProfileLanguagesSection } from './ProfileLanguagesSection';
import { ProfileProvenanceProvider } from './ProfileProvenanceChip';
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
    expect(html).toContain('career-profile-screen-lang-name">Английский</div>');
    expect(html).toContain('career-profile-screen-lang-level">свободный (C1)');
    expect(html.match(/career-profile-screen-lang-meter/g)).toHaveLength(2);
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(5);
    expect(html).toContain('источник неизвестен');
    expect(html).not.toContain('Full professional proficiency');
  });

  it('называет площадку и дату импорта языка, а добавленный вручную — словами кандидата (B541)', () => {
    const html = renderToStaticMarkup(
      <ProfileProvenanceProvider
        importedSources={[]}
        memory={[
          {
            id: 'mem-1',
            kind: 'fact',
            domain: 'skill',
            statement: 'English C1',
            confidence: 'candidate-reported',
            sourceMessageIds: ['import'],
            sensitive: false,
            status: 'proposed',
            provenance: { kind: 'import', platform: 'linkedin', at: '2026-09-12T08:00:00.000Z' },
          },
        ]}
      >
        <ProfileLanguagesSection
          draft={{
            ...baseDraft,
            languages: [
              ...baseDraft.languages.slice(0, 1),
              { id: 'lang-3', evidenceMemoryId: 'manual-1', name: 'Немецкий', cefr: 'B1' },
            ],
          }}
          onSectionSave={() => undefined}
        />
      </ProfileProvenanceProvider>,
    );
    expect(html).toContain('из LinkedIn, 12.09');
    expect(html).toContain('со слов кандидата');
    expect(html).not.toContain('Источник: импортированный профиль');
  });
});
