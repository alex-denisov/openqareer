import type { ReactNode } from 'react';
import { CaretLeft, CheckCircle, Circle } from '@phosphor-icons/react';

export interface RelocationHeaderCardProps {
  readonly title: string;
  readonly status: 'on' | 'off';
  readonly description: string;
  readonly backLabel: string;
  readonly onBack: () => void;
  readonly children?: ReactNode;
}

/** The framed head of mockup 15: back, title, state badge, one line of context, tabs. */
export function RelocationHeaderCard({ title, status, description, backLabel, onBack, children }: RelocationHeaderCardProps) {
  return (
    <header className="career-relocation-card career-relocation-header">
      <div className="career-relocation-title-row">
        <button className="career-relocation-back" type="button" aria-label={backLabel} onClick={onBack}>
          <CaretLeft aria-hidden="true" size={20} />
        </button>
        <h2 id="career-relocation-title">{title}</h2>
        <span className={`career-relocation-status${status === 'on' ? ' is-enabled' : ''}`}>
          {status === 'on' ? <CheckCircle aria-hidden="true" size={14} /> : <Circle aria-hidden="true" size={12} />}
          {status === 'on' ? 'Включено' : 'Не включено'}
        </span>
      </div>
      <p>{description}</p>
      {children}
    </header>
  );
}
