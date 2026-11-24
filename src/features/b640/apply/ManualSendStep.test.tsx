import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OpenVacancy } from './ManualSendStep';

describe('«Открыть вакансию» у отклика, который кандидат отправляет сам', () => {
  it('ведёт только на https', () => {
    expect(renderToStaticMarkup(<OpenVacancy url="https://example.com/1" />)).toContain(
      'href="https://example.com/1"',
    );
    for (const url of [
      'http://example.com/1',
      'javascript:alert(1)',
      'https://a:b@example.com',
      '',
      null,
    ]) {
      expect(renderToStaticMarkup(<OpenVacancy url={url} />)).toBe('');
    }
  });
});
