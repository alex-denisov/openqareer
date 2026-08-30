import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerTrackBoard } from './CareerTrackBoard';

/**
 * Production walkthrough of B160 caught the race: the cabinet reads the
 * account after it mounts, so «Изменить роль и условия» could be opened while
 * the current role and work mode were still unknown. Saving that form would
 * have written the empty form back over answers it never showed.
 */
function render(premisesLoading: boolean) {
  return renderToStaticMarkup(
    <CareerTrackBoard
      targetDirection="Senior Software Engineer"
      regions={['ru']}
      premises={{ targetRole: '', regions: [], workMode: null }}
      premisesLoading={premisesLoading}
      onNavigate={() => undefined}
      onSavePremises={async () => undefined}
    />,
  );
}

describe('route premises editing while the cabinet is still reading', () => {
  it('does not offer an editor over premises it has not read yet', () => {
    const html = render(true);

    expect(html).toContain('disabled');
    expect(html).toContain('Читаем текущие ответы');
  });

  it('offers the editor once the premises are known', () => {
    const html = render(false);

    expect(html).not.toContain('disabled');
    expect(html).not.toContain('Читаем текущие ответы');
    expect(html).toContain('Изменить роль и условия');
  });
});
