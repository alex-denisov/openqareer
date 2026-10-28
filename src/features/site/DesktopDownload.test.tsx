import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppVersionNote, parseDesktopRelease } from './DesktopDownload';

describe('desktop release on the landing (B576)', () => {
  it('takes the version only from a confirmed release', () => {
    expect(parseDesktopRelease({ data: { available: true, version: '1.1.4' } })).toBe('1.1.4');
    expect(parseDesktopRelease({ data: { available: false } })).toBeNull();
    expect(parseDesktopRelease({ data: { available: true, version: '<b>1</b>' } })).toBeNull();
    expect(parseDesktopRelease(null)).toBeNull();
  });

  it('writes the version note and nothing before the server answers', () => {
    expect(renderToStaticMarkup(<AppVersionNote version={null} />)).toBe('');
    expect(renderToStaticMarkup(<AppVersionNote version="1.1.4" />)).toBe(
      '<p class="appver">Версия <span class="appver-num">1.1.4</span> · приложение обновляется само</p>',
    );
  });
});
