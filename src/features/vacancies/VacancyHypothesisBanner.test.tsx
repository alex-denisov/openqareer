import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VacancyHypothesisBanner } from './VacancyHypothesisBanner';

function render(regionsChosenExplicitly: boolean) {
  const role = 'VP Technology Ops';
  return renderToStaticMarkup(
    <VacancyHypothesisBanner
      role={role}
      vacancyCount={5}
      availableRegions={[{ id: 'eu', label: 'Европа' }]}
      regionsChosenExplicitly={regionsChosenExplicitly}
      regionsOpen={false}
      remoteOnly={false}
      saving={false}
      onAddAdjacentRole={() => {}}
      onAddRegion={() => {}}
      onToggleRegions={() => {}}
      onToggleRemote={() => {}}
    />,
  );
}

describe('VacancyHypothesisBanner — гео-условие (C56)', () => {
  it('показывает «Выбрать регион», когда кандидат сам не выбирал регион', () => {
    expect(render(false)).toContain('Выбрать регион');
    expect(render(false)).not.toContain('Расширить географию');
  });

  it('показывает «Расширить географию», когда регион выбран явно кандидатом', () => {
    expect(render(true)).toContain('Расширить географию');
  });
});
