import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProfileSideRail } from './ProfileSideRail';
import type { ResumeDraft } from './resumeTypes';

const draft: ResumeDraft = {
  candidate: { fullName: 'Jordan Rivers' },
  experience: [],
  skills: [],
  education: [],
  languages: [],
  courses: [],
};

describe('ProfileSideRail source card (B266)', () => {
  it('does not claim a section is empty in the source, only that it is not filled', () => {
    const html = renderToStaticMarkup(<ProfileSideRail draft={draft} />);
    expect(html).not.toContain('пусто в источнике');
    expect(html).toContain('не заполнено');
  });

  it('sends a re-import to the connections, not to a server re-read labelled as an import', () => {
    const html = renderToStaticMarkup(<ProfileSideRail draft={draft} onOpenConnections={() => {}} />);
    expect(html).not.toContain('Обновить импорт');
    expect(html).toContain('Импорт и подключения');
  });

  it('shows no import button when nothing can open the connections', () => {
    expect(renderToStaticMarkup(<ProfileSideRail draft={draft} />)).not.toContain('<button');
  });
});
