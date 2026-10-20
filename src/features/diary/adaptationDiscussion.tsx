import { createContext, useContext, useEffect, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { CoachTurnSubject } from '../coach/coachApi';
import type { ExpertPanelConfig } from '../shell/CareerWorkspaceShellHelpers';

export interface AdaptationDiscussionTarget {
  subject: Extract<CoachTurnSubject, { kind: 'adaptation' }>;
  title: string;
}
const Discussion = createContext<((target: AdaptationDiscussionTarget) => void) | undefined>(undefined);
export const ADAPTATION_CONTEXT_EVENT = 'career-adaptation-context';
export const ADAPTATION_SAVED_EVENT = 'career-adaptation-saved';

export function AdaptationDiscussionProvider({ onOpen, children }: { onOpen?: (target: AdaptationDiscussionTarget) => void; children: ReactNode }) {
  return <Discussion.Provider value={onOpen}>{children}</Discussion.Provider>;
}

export function useAdaptationDiscussion(target: AdaptationDiscussionTarget) {
  const open = useContext(Discussion);
  const key = JSON.stringify(target);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(ADAPTATION_CONTEXT_EVENT, { detail: JSON.parse(key) }));
  }, [key]);
  return open ? () => open(target) : undefined;
}

export function useAdaptationPanelContext(view: string, setConfig: Dispatch<SetStateAction<ExpertPanelConfig>>) {
  useEffect(() => {
    if (view !== 'diary') return;
    const update = (event: Event) => {
      const target = (event as CustomEvent<AdaptationDiscussionTarget | null>).detail;
      setConfig(previous => previous.stage === 'diary' && previous.subject?.kind === 'adaptation'
        ? { ...previous, subject: target?.subject, subjectTitle: target?.title, initialPrompt: undefined }
        : previous);
    };
    window.addEventListener(ADAPTATION_CONTEXT_EVENT, update);
    return () => window.removeEventListener(ADAPTATION_CONTEXT_EVENT, update);
  }, [view, setConfig]);
}
