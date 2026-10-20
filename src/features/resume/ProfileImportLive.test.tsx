import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  linkedinImportProgressView,
  reduceLinkedInImportProgress,
} from '../connections/linkedinImportProgress';
import { ImportLiveBlock, ProfileImportLive } from './ProfileImportLive';

describe('ProfileImportLive', () => {
  it('renders nothing while no LinkedIn walk is running', () => {
    expect(renderToStaticMarkup(<ProfileImportLive />)).toBe('');
  });

  it('names the section count and marks read stages', () => {
    const started = reduceLinkedInImportProgress(null, {
      type: 'start',
      keys: ['experience', 'education', 'skills'],
    });
    const view = linkedinImportProgressView(
      reduceLinkedInImportProgress(started, { type: 'read', key: 'experience' }),
    );
    if (!view) throw new Error('walk should be running');
    const html = renderToStaticMarkup(<ImportLiveBlock view={view} />);
    expect(html).toContain('читаем разделы');
    expect(html).toContain('role="status"');
    expect(html).toMatch(/<li class="is-done">.*места работы/u);
    expect(html).toMatch(/<li>.*образование/u);
    expect(html).toContain('value="33"');
    expect(html).toContain('max="100"');
    expect(html).toContain('Прочитано разделов: 1 из 3, 33 %');
  });

  it('shows the stored walk after a reload with the reimport inside the band (B541)', () => {
    const sections = [
      { key: 'experience', status: 'read' as const },
      { key: 'education', status: 'read' as const },
      { key: 'skills', status: 'read' as const },
      { key: 'languages', status: 'failed' as const },
      { key: 'projects', status: 'pending' as const },
      { key: 'courses', status: 'pending' as const },
      { key: 'contactInfo', status: 'pending' as const },
    ];
    const running = renderToStaticMarkup(
      <ProfileImportLive
        onReimport={() => undefined}
        storedWalk={{
          platform: 'linkedin',
          state: 'running',
          updatedAt: '2026-10-20T08:00:00.000Z',
          sections,
        }}
      />,
    );
    expect(running).toContain('LinkedIn: читаем разделы, 3 из 7');
    expect(running).toContain('Импортировать заново');
    expect(running).toMatch(/<li class="is-done">.*места работы/u);
    expect(running).toMatch(/<li class="is-failed">.*языки/u);
    expect(running).toContain('контакты');
    const done = renderToStaticMarkup(
      <ProfileImportLive
        storedWalk={{
          platform: 'linkedin',
          state: 'done',
          updatedAt: '2026-10-20T08:00:00.000Z',
          sections,
        }}
      />,
    );
    expect(done).toContain('LinkedIn: прочитано 3 из 7, 20.10');
  });
});
