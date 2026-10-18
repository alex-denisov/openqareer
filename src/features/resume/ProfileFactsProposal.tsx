import { useEffect, useState } from 'react';
import { Check, X } from '@phosphor-icons/react';
import { getResumeStudio } from './resumeApi';
import { draftOf } from './resumeStudioModel';

/** The four topics the approved Profile mockup names for a fact-gathering conversation. */
const FACT_TOPICS = 'команда, бюджет, результат релизов, найм';
const FACT_QUESTION_COUNT = 4;
const DISMISSED_KEY = 'openqareer.profile-facts-proposal-dismissed';

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(employer: string): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, employer);
  } catch {
    // Storage can be blocked; the card then hides only until the next mount.
  }
}

/** The current employer is the one the consultant offers to gather facts about. */
function useCurrentEmployer(): string | undefined {
  const [employer, setEmployer] = useState<string>();
  useEffect(() => {
    let active = true;
    void getResumeStudio()
      .then((view) => {
        if (!active) return;
        const entry = draftOf(view).experience.find((item) => item.current && item.employer);
        setEmployer(entry?.employer?.trim() || undefined);
      })
      .catch(() => {
        if (active) setEmployer(undefined);
      });
    return () => {
      active = false;
    };
  }, []);
  return employer;
}

/**
 * «Собрать факты по «Финтех Лаб»» (2-profil.html): an offer, not an action — «Начать» only
 * opens the conversation with the consultant; nothing in the profile changes until the
 * candidate accepts the edits that conversation produces.
 */
export function ProfileFactsProposal({ onStart }: { readonly onStart: (prompt: string) => void }) {
  const employer = useCurrentEmployer();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!employer || dismissed === employer) return null;
  const title = `Собрать факты по «${employer}»`;
  return (
    <section className="career-expert-proposal" aria-label={title}>
      <p className="career-expert-proposal-title">{title}</p>
      <p>
        {FACT_QUESTION_COUNT} вопроса: {FACT_TOPICS}.
      </p>
      <div className="career-expert-actions">
        <button
          type="button"
          className="career-quiet-button career-inline-ok"
          onClick={() => onStart(`Соберём факты по «${employer}»: ${FACT_TOPICS}.`)}
        >
          <Check size={16} aria-hidden="true" />
          Начать
        </button>
        <button
          type="button"
          className="career-quiet-button"
          onClick={() => {
            writeDismissed(employer);
            setDismissed(employer);
          }}
        >
          <X size={16} aria-hidden="true" />
          Не сейчас
        </button>
      </div>
    </section>
  );
}
