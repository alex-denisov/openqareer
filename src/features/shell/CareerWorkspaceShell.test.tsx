import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerWorkspaceShell } from './CareerWorkspaceShell';

describe('CareerWorkspaceShell', () => {
  it('keeps a first-time candidate inside the canonical career shell', () => {
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell
        onClearWorkspace={() => undefined}
        onSaveWorkspace={() => undefined}
        onUpdateWorkspace={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="career-shell"');
    expect(html).toContain('С чем разобраться?');
    expect(html).toContain('Сегодня');
    expect(html).toContain('Профиль');
    expect(html).toContain('Карьера');
    expect(html).toContain('Возможности');
    expect(html).not.toContain('career-intent-list" role="list');
    expect(html).not.toContain('data-testid="workspace-setup"');
  });
});
