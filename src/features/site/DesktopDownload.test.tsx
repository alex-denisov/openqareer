import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesktopDownload, formatMegabytes } from './DesktopDownload';

describe('DesktopDownload', () => {
  it('renders no dead button before the server confirms a build', () => {
    expect(renderToStaticMarkup(<DesktopDownload />)).toBe('');
  });

  it('formats the size in megabytes', () => {
    expect(formatMegabytes(37176009)).toBe('35.5 МБ');
  });
});
