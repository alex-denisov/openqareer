// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProfileMobileImportParams } from './ProfileMobileSections';

describe('ProfileMobileImportParams (390, C6)', () => {
  it('shows import facts, read sections and a retry row for an unread one', () => {
    const html = renderToStaticMarkup(
      <ProfileMobileImportParams
        onRetry={() => undefined}
        importedSources={[
          {
            platform: 'linkedin',
            lastImportedAt: '2026-10-23T08:00:00.000Z',
            factCount: 59,
            keptFactCount: 58,
            walk: {
              platform: 'linkedin',
              state: 'done',
              updatedAt: '2026-10-23T08:00:00.000Z',
              sections: [
                { key: 'experience', status: 'read' },
                { key: 'contactInfo', status: 'failed' },
              ],
            },
          } as never,
        ]}
      />,
    );
    expect(html).toContain('Импортировано 58 из 59 фактов, 23.10.');
    expect(html).toContain('Прочитано разделов: 1 из 2');
    expect(html).toContain('Раздел «контакты» не прочитан');
    expect(html).toContain('Повторить раздел');
  });
});
