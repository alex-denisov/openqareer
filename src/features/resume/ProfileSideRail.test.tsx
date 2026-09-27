import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProfileSideRail } from './ProfileSideRail';
import type { ResumeDraft } from './resumeTypes';

const draft: ResumeDraft = {
  candidate: { fullName: 'Jordan Rivers', contact: { email: 'jordan@example.com' } },
  experience: [],
  skills: [],
  education: [],
  languages: [],
  courses: [],
};

describe('ProfileSideRail (C54 — source moved to the topcard)', () => {
  it('no longer renders a separate «Источник профиля» card — it lives in the topcard now', () => {
    const html = renderToStaticMarkup(<ProfileSideRail draft={draft} />);
    expect(html).not.toContain('Источник профиля');
    expect(html).not.toContain('Импорт и подключения');
  });

  it('still renders the contacts panel', () => {
    const html = renderToStaticMarkup(<ProfileSideRail draft={draft} />);
    expect(html).toContain('jordan@example.com');
  });
});
