import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CaretLeft, Sparkle } from '@phosphor-icons/react';
import { ArchivedResponsesSection } from './ArchivedResponsesSection';
import { ArchiveReasonsList } from './PipelineAnalyticsView';
import { closedResponseReasons, isClosedResponse } from './ResponsesMobileLinks';
import type { UseApplications } from './useApplications';
import './responses-mobile-process.css';

/** 390 push screens of «Отклики» (mockup 5: `mv=proc`, `mv=learn`, closed list). */
export type ResponsesMobilePushView =
  | { readonly kind: 'response'; readonly id: string }
  | { readonly kind: 'channels' }
  | { readonly kind: 'closed' };

/** Same breakpoint as `responses-mobile.css`; push screens exist only below it. */
const COMPACT_QUERY = '(max-width: 40rem)';

export function useCompactResponses(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(COMPACT_QUERY).matches === true,
  );
  useEffect(() => {
    const media = window.matchMedia?.(COMPACT_QUERY);
    if (!media) return undefined;
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}

const PUSH_TITLES: Record<ResponsesMobilePushView['kind'], string> = {
  response: 'Процесс',
  channels: 'Каналы',
  closed: 'Закрыто',
};

export function ResponsesMobilePush({
  view,
  onBack,
  onOpenConsultant,
  children,
}: {
  readonly view: ResponsesMobilePushView;
  readonly onBack: () => void;
  /** Right slot of the push bar, the same consultant as the shell top bar it covers. */
  readonly onOpenConsultant?: () => void;
  readonly children: ReactNode;
}) {
  const titleId = useId();
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
    window.scrollTo?.({ top: 0 });
  }, [view]);
  return (
    <section className="career-responses-mobile-push" aria-labelledby={titleId}>
      <header className="career-responses-mobile-push-header">
        <button
          ref={backRef}
          type="button"
          className="career-responses-mobile-push-back"
          aria-label="Назад к откликам"
          onClick={onBack}
        >
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <h2 id={titleId}>{PUSH_TITLES[view.kind]}</h2>
        {onOpenConsultant ? (
          <button
            type="button"
            className="career-responses-mobile-push-consultant"
            aria-label="Консультант: открыть"
            onClick={onOpenConsultant}
          >
            <Sparkle size={18} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** «Закрыто»: closing reasons and the archive with restore (moved off the 390 page, R19). */
export function ResponsesMobileClosedContent({ state }: { readonly state: UseApplications }) {
  const closed = state.applications.filter(isClosedResponse);
  return (
    <>
      {closed.length > 0 ? (
        <ArchiveReasonsList
          reasons={closedResponseReasons(closed)}
          title="Причины закрытия откликов"
        />
      ) : null}
      <ArchivedResponsesSection
        applications={state.applications.filter((item) => item.stage === 'archived')}
        initiallyOpen
        onRestore={state.restoreFromArchive}
      />
    </>
  );
}
