import { describe, expect, it } from 'vitest';
import { candidateMediaPath, mediaDataUrl } from './candidateMediaSrc';

describe('candidate media for the desktop app (B266)', () => {
  it('turns the JSON form of a photo into a data URL', () => {
    expect(mediaDataUrl({ data: { mime: 'image/jpeg', base64: '/9j/4AA=' } })).toBe(
      'data:image/jpeg;base64,/9j/4AA=',
    );
  });

  it('refuses anything that is not a plain image payload', () => {
    expect(mediaDataUrl({ data: { mime: 'text/html', base64: 'PGgxPg==' } })).toBeUndefined();
    expect(mediaDataUrl({ data: { mime: 'image/png', base64: 'x"><script>' } })).toBeUndefined();
    expect(mediaDataUrl({ error: 'media_not_found' })).toBeUndefined();
    expect(mediaDataUrl(null)).toBeUndefined();
  });

  it('encodes the media id into the path', () => {
    expect(candidateMediaPath('a/b')).toBe('/api/v1/candidate/media/a%2Fb');
  });
});
