import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProfileProjectsSection } from './ProfileTileSections';
import { ProfileProvenanceProvider } from './ProfileProvenanceChip';
import type { ResumeDraft } from './resumeTypes';

describe('ProfileProjectsSection', () => {
  it('shows the employer and the description on separate lines (block A 30.10)', () => {
    const draft: ResumeDraft = {
      candidate: { fullName: 'Алексей Денисов' },
      targetRole: 'VP of Technology',
      experience: [],
      education: [],
      languages: [],
      projects: [
        {
          id: 'p1',
          name: 'AI Automation Lab',
          description: 'Built multi-agent workflow automation.',
          employer: 'OptiLab AI',
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProfileProvenanceProvider memory={[]} importedSources={[]}>
        <ProfileProjectsSection draft={draft} onSectionSave={() => undefined} />
      </ProfileProvenanceProvider>,
    );

    expect(html).not.toContain('automation., OptiLab AI');
    expect(html).toMatch(/<p class="career-profile-screen-tile-meta">OptiLab AI<\/p>/u);
    expect(html).toMatch(
      /<p class="profile-project-description">Built multi-agent workflow automation\.<\/p>/u,
    );
  });
});
