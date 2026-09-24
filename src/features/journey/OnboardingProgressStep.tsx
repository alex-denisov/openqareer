import { Check } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import type { ParseProgressCounts } from './profileFactReviewRows';

interface OnboardingProgressStepProps {
  readonly busy: boolean;
  readonly counts: ParseProgressCounts;
  readonly error?: string;
}

interface ProgressRow {
  readonly id: string;
  readonly label: string;
  readonly state: 'done' | 'active' | 'wait';
}

function buildRows(busy: boolean, counts: ParseProgressCounts): ProgressRow[] {
  const hasAnything = counts.jobCount > 0 || counts.hasEducation || counts.hasSkills;
  const fileRow: ProgressRow = {
    id: 'file',
    label: busy
      ? 'Читаем файл — места работы, образование, навыки'
      : hasAnything
        ? `Прочитан файл — ${pluralRu(counts.jobCount, ['место работы', 'места работы', 'мест работы'])}, образование, навыки`
        : 'Прочитан файл — не нашли структурированных разделов, можно дополнить вручную',
    state: busy ? 'active' : 'done',
  };
  const numbersRow: ProgressRow = {
    id: 'numbers',
    label: busy
      ? 'Извлекаем цифры результатов…'
      : `Извлечены цифры результатов — ${counts.bulletsWithNumber} из ${counts.totalBullets} пунктов`,
    state: busy ? 'wait' : 'done',
  };
  const marketRow: ProgressRow = {
    id: 'market',
    label: 'Сверяем роли с рынком по вашему опыту…',
    state: busy ? 'wait' : 'active',
  };
  const rangeRow: ProgressRow = {
    id: 'range',
    label: 'Считаем вилки по подходящим ролям',
    state: 'wait',
  };
  return [fileRow, numbersRow, marketRow, rangeRow];
}

/**
 * Step 2a, "Разбираем резюме" (onboarding.html): live rows with the parser's
 * own numbers, not a generic spinner. Nothing here asks the candidate to
 * confirm anything yet — that is step 3.
 */
export function OnboardingProgressStep(props: OnboardingProgressStepProps) {
  const rows = buildRows(props.busy, props.counts);
  return (
    <div className="career-onboarding-progress-list">
      {rows.map((row) => (
        <div key={row.id} className={`career-onboarding-progress-row is-${row.state}`}>
          <span className="career-onboarding-progress-mark">
            {row.state === 'done' ? <Check size={14} weight="bold" /> : null}
          </span>
          {row.label}
        </div>
      ))}
      {props.error ? (
        <p className="career-intake-error" role="alert">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}
