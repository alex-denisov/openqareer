// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProfileTeamSizeTag, teamSizeLabel } from './ProfileTeamSizeTag';

describe('team size tag (B540)', () => {
  it('warns when the team size of a place is unknown', () => {
    const html = renderToStaticMarkup(<ProfileTeamSizeTag teamSize={undefined} />);
    expect(html).toContain('is-warning');
    expect(html).toContain('Размер команды: неизвестно');
  });

  it('shows a known team size in people', () => {
    const html = renderToStaticMarkup(<ProfileTeamSizeTag teamSize={38} />);
    expect(html).not.toContain('is-warning');
    expect(html).toContain('Команда: 38 человек');
  });

  it('declines people by number', () => {
    expect(teamSizeLabel(1)).toBe('1 человек');
    expect(teamSizeLabel(3)).toBe('3 человека');
    expect(teamSizeLabel(38)).toBe('38 человек');
  });
});
