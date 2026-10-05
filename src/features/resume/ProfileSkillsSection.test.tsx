import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProfileSkillsSection } from './ProfileSkillsSection';
import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';

describe('ProfileSkillsSection (B376)', () => {
  it('renders skill chips with verification status, source, and date', () => {
    const draft = {
      ...EMPTY_RESUME_DRAFT,
      skills: [
        {
          id: 'sk-1',
          name: 'TypeScript',
          status: 'подтверждён',
          source: 'Банк квизов hh.ru',
          verifiedAt: '2026-10-05',
        },
        {
          id: 'sk-2',
          name: 'Docker',
          status: 'не подтверждён',
          source: 'Банк квизов LinkedIn',
          verifiedAt: '2026-10-05',
        },
        {
          id: 'sk-3',
          name: 'React',
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProfileSkillsSection draft={draft} onSectionSave={() => undefined} />,
    );

    expect(html).toContain('TypeScript');
    expect(html).toContain('is-verified');
    expect(html).toContain('подтверждён');
    expect(html).toContain('Банк квизов hh.ru');
    expect(html).toContain('2026-10-05');

    expect(html).toContain('Docker');
    expect(html).toContain('is-unverified');
    expect(html).toContain('не подтверждён');
    expect(html).toContain('Банк квизов LinkedIn');

    expect(html).toContain('React');
  });
});
