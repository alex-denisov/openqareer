import { useRef, useState } from 'react';
import { CoachApiError } from '../coach/coachApi';
import { revertCareerCommand } from '../coach/careerCommandApi';
import type { SkillQuizApplyResponse } from '../coach/careerCommandApi';

type RevertState = 'applied' | 'reverted' | 'missing';

export function SkillQuizApplyResultCard({
  commandId,
  fact,
  result,
}: Pick<SkillQuizApplyResponse, 'commandId' | 'fact' | 'result'>) {
  const { state, busy, error, message, revert } = useSkillQuizRevert(commandId, fact, result);
  const messageRole = state === 'missing' || (state === 'reverted' && error) ? 'alert' : 'status';

  return (
    <article
      className="career-dialogue-turn is-assistant career-expert-skill-quiz-result"
      aria-live="polite"
    >
      <span>Карьерный консультант</span>
      <p role={messageRole}>{message}</p>
      {error && state === 'applied' ? (
        <p className="career-expert-error" role="alert">
          {error}
        </p>
      ) : null}
      {state === 'applied' ? (
        <button
          className="career-quiet-button"
          type="button"
          disabled={busy}
          onClick={() => void revert()}
        >
          {busy ? 'Откатываем…' : 'Откатить'}
        </button>
      ) : null}
    </article>
  );
}

function useSkillQuizRevert(
  commandId: string,
  fact: SkillQuizApplyResponse['fact'],
  result: SkillQuizApplyResponse['result'],
) {
  const [state, setState] = useState<RevertState>('applied');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);

  async function revert(): Promise<void> {
    if (busy || inFlight.current || state !== 'applied') return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await revertCareerCommand(commandId);
      setState('reverted');
    } catch (reason) {
      const failure = revertFailure(reason);
      setState(failure.state);
      setError(failure.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { state, busy, error, message: resultMessage(state, error, fact, result), revert };
}

function revertFailure(reason: unknown): { state: RevertState; message: string } {
  if (reason instanceof CoachApiError && reason.code === 'profile_revision_already_reverted') {
    return { state: 'reverted', message: 'Это изменение уже отменено' };
  }
  if (
    reason instanceof CoachApiError &&
    ['career_command_not_found', 'profile_revision_not_found'].includes(reason.code)
  ) {
    return { state: 'missing', message: 'Результат не найден, обновите страницу' };
  }
  return { state: 'applied', message: 'Не удалось отменить результат. Попробуйте ещё раз.' };
}

function resultMessage(
  state: RevertState,
  error: string | undefined,
  fact: SkillQuizApplyResponse['fact'],
  result: SkillQuizApplyResponse['result'],
): string {
  if (error && state !== 'applied') return error;
  if (state === 'reverted') return 'Изменение отменено.';
  if (state === 'missing') return 'Результат не найден, обновите страницу';
  return `Навык обновлён: ${fact.skillName} — ${result.statusLabel} (${fact.source}, ${fact.date}).`;
}
