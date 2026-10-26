import { useEffect, useRef, type ReactNode } from 'react';
import { PushConsultantButton } from '../shell/PushConsultantButton';
import { CaretLeft } from '@phosphor-icons/react';
import '../vacancies/vacancy-push.css';

/**
 * A 390 push screen of mockup 15 (country, document, questionnaire, add):
 * it covers the shell top bar like the vacancy and company push screens —
 * round back button, one centred title, the content below.
 */
export function MobilePush({
  title,
  backLabel = 'Назад',
  onBack,
  children,
}: {
  readonly title: string;
  readonly backLabel?: string;
  readonly onBack: () => void;
  readonly children: ReactNode;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => backRef.current?.focus(), []);
  return (
    <>
      <div className="vacancy-push-backdrop" aria-hidden="true" />
      <div
        className="vacancy-push career-relocation-push"
        role="region"
        aria-labelledby="career-relocation-mobile-title"
      >
        <header className="vacancy-push-bar">
          <button
            ref={backRef}
            className="vacancy-push-back"
            type="button"
            aria-label={backLabel}
            onClick={onBack}
          >
            <CaretLeft aria-hidden="true" size={20} />
          </button>
          <h1 id="career-relocation-mobile-title">{title}</h1>
          <PushConsultantButton />
        </header>
        <div className="vacancy-push-body career-relocation career-relocation-mobile">
          {children}
        </div>
      </div>
    </>
  );
}
