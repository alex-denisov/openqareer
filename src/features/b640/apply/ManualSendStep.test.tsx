import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LetterItem, OpenVacancy } from './ManualSendStep';

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

describe('Письмо отклика, который кандидат отправляет сам', () => {
  it('с опровергнутыми фактами не копируется, а ведёт к письму', () => {
    const html = renderToStaticMarkup(
      <LetterItem text="CSAT 68%" stale pending={false} onLetter={() => undefined} />,
    );
    expect(html).not.toContain('CSAT 68%');
    expect(html).toContain('Факты профиля изменились');
    expect(html).toContain('К письму');
  });
});
