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
    expect(html).toContain('value="1"');
    expect(html).toContain('max="3"');
  });
});
