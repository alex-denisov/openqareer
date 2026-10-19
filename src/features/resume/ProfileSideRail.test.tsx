import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProfileSideRail, profileRelocationSummaryDetail } from './ProfileSideRail';
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

describe('profile relocation summary (макет 2 «Релокация: не включена»)', () => {
  it('invites the short questionnaire when relocation is off', () => {
    expect(profileRelocationSummaryDetail('not_enabled')).toBe(
      'Релокация выключена. Включите её, ответив на короткую анкету, около 5 минут.',
    );
  });

  it('labels the desktop action «Заполнить анкету» while relocation is off', () => {
    const html = renderToStaticMarkup(
      <ProfileSideRail
        draft={draft}
        desktopLayout
        relocationSummary="not_enabled"
        onOpenRelocation={vi.fn()}
      />,
    );
    expect(html).toContain('Заполнить анкету');
    expect(html).not.toContain('<span>Открыть</span>');
  });
});
