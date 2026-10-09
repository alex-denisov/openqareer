import { CaretDown, CheckCircle, Minus } from '@phosphor-icons/react';
import {
  COMPARISON_STEPS,
  TARIFF_LEVELS,
  type ComparisonStep,
  type TariffLevel,
} from './tariffsData';

interface TariffComparisonProps {
  readonly defaultOpen?: boolean;
}

export function TariffComparisonTable({ defaultOpen = false }: TariffComparisonProps) {
  return (
    <details className="career-tariffs-compare" id="cmp" open={defaultOpen}>
      <summary className="career-tariffs-compare-summary">
        <h3 className="career-tariffs-compare-title">Сравнить уровни по шагам пути</h3>
        <span className="career-tariff-chevron" aria-hidden="true">
          <CaretDown size={18} />
        </span>
      </summary>
      <div className="career-tariffs-compare-body">
        <div className="career-cmp-grid" role="table" aria-label="Сравнение тарифов по шагам пути">
          <ComparisonHeader levels={TARIFF_LEVELS} />
          {COMPARISON_STEPS.map((step) => (
            <ComparisonRow key={step.title} step={step} levels={TARIFF_LEVELS} />
          ))}
        </div>
      </div>
    </details>
  );
}

function ComparisonHeader({ levels }: { readonly levels: readonly TariffLevel[] }) {
  return (
    <div className="career-cmp-row is-head" role="row">
      <span className="career-cmp-step" role="columnheader">
        Шаг пути
      </span>
      {levels.map((level) => (
        <span key={level.id} className="career-cmp-cell" role="columnheader">
          {level.name}
        </span>
      ))}
    </div>
  );
}

function ComparisonRow({
  step,
  levels,
}: {
  readonly step: ComparisonStep;
  readonly levels: readonly TariffLevel[];
}) {
  return (
    <div className={`career-cmp-row ${step.isHere ? 'is-here' : ''}`} role="row">
      <span className="career-cmp-step" role="rowheader">
        {step.title}
        {step.isHere ? ' (вы здесь)' : ''}
      </span>
      {levels.map((level, idx) => (
        <ComparisonCell key={level.id} step={step} tierIdx={idx} />
      ))}
    </div>
  );
}

function ComparisonCell({
  step,
  tierIdx,
}: {
  readonly step: ComparisonStep;
  readonly tierIdx: number;
}) {
  if (tierIdx < step.tierIndex) {
    return (
      <span className="career-cmp-cell is-no" role="cell" aria-label="Не входит">
        <Minus size={16} aria-hidden="true" />
      </span>
    );
  }

  if (tierIdx === step.tierIndex && step.note) {
    return (
      <span className="career-cmp-cell is-text" role="cell">
        <CheckCircle size={16} weight="fill" className="career-cmp-cell is-yes" aria-hidden="true" />
        <span>{step.note}</span>
      </span>
    );
  }

  return (
    <span className="career-cmp-cell is-yes" role="cell" aria-label="Входит">
      <CheckCircle size={16} weight="fill" aria-hidden="true" />
    </span>
  );
}
