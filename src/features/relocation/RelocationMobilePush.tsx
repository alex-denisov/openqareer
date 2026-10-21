import type { ReactNode } from 'react';
import { CaretLeft } from '@phosphor-icons/react';

/** A 390 push screen: back chevron, one title, content. */
export function MobilePush({ title, backLabel = 'Назад', onBack, children }: {
  readonly title: string;
  readonly backLabel?: string;
  readonly onBack: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="career-relocation career-relocation-mobile" role="region" aria-labelledby="career-relocation-mobile-title">
      <header className="career-relocation-mobile-bar">
        <button className="career-relocation-back" type="button" aria-label={backLabel} onClick={onBack}>
          <CaretLeft aria-hidden="true" size={20} />
        </button>
        <h2 id="career-relocation-mobile-title">{title}</h2>
      </header>
      {children}
    </div>
  );
}
