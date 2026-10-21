import type { CountryFitStatus, ScenarioAvailability } from '../../../shared/countryFit/types';

/** Status words of mockup 15; one label for the list, the comparison and 390. */
export function relocationStatusLabel(status: CountryFitStatus | ScenarioAvailability): string {
  if (status === 'available') return 'Доступно без ограничений';
  if (status === 'barriers') return 'Есть условия';
  if (status === 'high_barriers') return 'Высокие барьеры';
  if (status === 'unavailable' || status === 'legally_unavailable') return 'Юридически недоступно';
  return 'Нужно уточнить';
}
