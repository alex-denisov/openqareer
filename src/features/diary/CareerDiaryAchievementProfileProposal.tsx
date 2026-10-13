import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowClockwise, CaretLeft, Sparkle } from '@phosphor-icons/react';
import type { CareerDiaryAchievement } from '../../../shared/careerDiary';
import { CareerActionProposalCard } from '../journey/CareerCommandActions';
import { getCareerCommand, prepareCareerCommand } from '../coach/careerCommandApi';
import { sendCoachTurn, type CareerCommand, type CoachResult } from '../coach/coachApi';
import {
  careerDiaryProfileProposals,
  buildCareerDiaryAchievementPrompt,
} from './careerDiaryAchievementProposal';

export function CareerDiaryAchievementProfileProposal({
  achievement,
  onClose,
  onPrepared,
}: {
  readonly achievement: CareerDiaryAchievement;
  readonly onClose: () => void;
  readonly onPrepared: () => void;
}) {
  const profile = useCareerDiaryProfileProposal(achievement);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
      else
        window.requestAnimationFrame(() =>
          document.getElementById('career-diary-achievements-title')?.focus(),
        );
    };
  }, []);
  const proposals =
    profile.result && profile.messageId
      ? careerDiaryProfileProposals(profile.result, profile.messageId)
      : [];
  return (
    <CareerDiaryAchievementProfileProposalContent
      achievement={achievement}
      headingRef={headingRef}
      result={profile.result}
      proposals={proposals}
      turnIdempotencyKey={profile.turnKey}
      sending={profile.sending}
      error={profile.error}
      onClose={onClose}
      onAsk={profile.ask}
      onRetry={profile.retry}
      onPrepared={onPrepared}
    />
  );
}

function useCareerDiaryProfileProposal(achievement: CareerDiaryAchievement) {
  const request = useRef<{ readonly key: string; readonly messageId: string }>();
  const [turnKey, setTurnKey] = useState<string>();
  const [messageId, setMessageId] = useState<string>();
  const [result, setResult] = useState<CoachResult>();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const ask = useCallback(async () => {
    if (sending) return;
    request.current ??= {
      key: crypto.randomUUID(),
      messageId: `diary:${achievement.id}:${crypto.randomUUID().slice(0, 8)}`,
    };
    setSending(true);
    setError(undefined);
    try {
      const response = await sendCoachTurn({
        content: buildCareerDiaryAchievementPrompt(achievement),
        stage: 'profile',
        idempotencyKey: request.current.key,
        messageId: request.current.messageId,
      });
      setTurnKey(request.current.key);
      setMessageId(request.current.messageId);
      setResult(response);
    } catch {
      setError('Не удалось получить предложение консультанта. Повторите попытку.');
    } finally {
      setSending(false);
    }
  }, [achievement, sending]);

  const retry = useCallback(() => {
    request.current = undefined;
    setResult(undefined);
    setMessageId(undefined);
    setTurnKey(undefined);
    setError(undefined);
  }, []);

  return { ask, retry, result, turnKey, messageId, sending, error };
}

interface CareerDiaryAchievementProfileProposalContentProps {
  readonly achievement: CareerDiaryAchievement;
  readonly headingRef: RefObject<HTMLHeadingElement>;
  readonly result?: CoachResult;
  readonly proposals: ReturnType<typeof careerDiaryProfileProposals>;
  readonly turnIdempotencyKey?: string;
  readonly sending: boolean;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onAsk: () => void;
  readonly onRetry: () => void;
  readonly onPrepared: () => void;
}

function DiaryProfileProposalHeader({
  headingRef,
  onClose,
}: Pick<CareerDiaryAchievementProfileProposalContentProps, 'headingRef' | 'onClose'>) {
  return (
    <header className="career-diary-profile-proposal__header">
      <button
        className="career-btn is-ghost is-icon career-diary-back"
        type="button"
        aria-label="Назад к достижениям"
        onClick={onClose}
      >
        <CaretLeft size={20} aria-hidden="true" />
      </button>
      <div>
        <p className="career-diary-eyebrow">Источник: карьерный дневник</p>
        <h2 id="career-diary-profile-proposal-title" ref={headingRef} tabIndex={-1}>
          Предложение в профиль
        </h2>
      </div>
    </header>
  );
}

function DiaryAchievementEvidence({
  achievement,
}: Pick<CareerDiaryAchievementProfileProposalContentProps, 'achievement'>) {
  return (
    <div className="career-diary-profile-proposal__evidence">
      <p>
        <strong>Ситуация</strong>
        {achievement.situation}
      </p>
      <p>
        <strong>Действие</strong>
        {achievement.action}
      </p>
      <p>
        <strong>Результат</strong>
        {achievement.result}
      </p>
    </div>
  );
}

function DiaryConsultantPrompt({
  result,
  sending,
  onAsk,
}: Pick<CareerDiaryAchievementProfileProposalContentProps, 'result' | 'sending' | 'onAsk'>) {
  if (result) return null;
  return (
    <button
      className="career-btn is-primary"
      type="button"
      disabled={sending}
      aria-busy={sending}
      onClick={onAsk}
    >
      <Sparkle size={18} aria-hidden="true" />
      {sending ? 'Запрашиваем предложение…' : 'Спросить консультанта'}
    </button>
  );
}

function DiaryProposalList({
  proposals,
  turnIdempotencyKey,
  onPrepared,
}: Pick<
  CareerDiaryAchievementProfileProposalContentProps,
  'proposals' | 'turnIdempotencyKey' | 'onPrepared'
>) {
  return proposals.map(({ proposal, index }) => (
    <DiaryProfileProposalAction
      key={String(index)}
      proposal={proposal}
      proposalIndex={index}
      turnIdempotencyKey={turnIdempotencyKey!}
      onPrepared={onPrepared}
    />
  ));
}

function DiaryProposalFeedback({
  result,
  proposalCount,
  error,
  sending,
  onRetry,
}: Pick<
  CareerDiaryAchievementProfileProposalContentProps,
  'result' | 'error' | 'sending' | 'onRetry'
> & { readonly proposalCount: number }) {
  const noProposal = Boolean(result && proposalCount === 0);
  return (
    <>
      {noProposal ? (
        <p className="career-diary-note" role="status">
          Консультант не предложил профильную правку, связанную с этой записью. Ничего не добавлено.
        </p>
      ) : null}
      {error ? (
        <p className="career-diary-error" role="alert">
          {error}
        </p>
      ) : null}
      {noProposal ? (
        <button className="career-btn is-ghost" type="button" disabled={sending} onClick={onRetry}>
          <ArrowClockwise size={18} aria-hidden="true" />
          Спросить ещё раз
        </button>
      ) : null}
    </>
  );
}

function CareerDiaryAchievementProfileProposalContent(
  props: CareerDiaryAchievementProfileProposalContentProps,
) {
  return (
    <section
      className="career-diary-profile-proposal"
      aria-labelledby="career-diary-profile-proposal-title"
    >
      <DiaryProfileProposalHeader headingRef={props.headingRef} onClose={props.onClose} />
      <DiaryAchievementEvidence achievement={props.achievement} />
      <p className="career-diary-note">
        Консультант видит эту запись как источник. Правка появится в профиле только после вашего
        принятия; её можно будет откатить.
      </p>
      <DiaryConsultantPrompt result={props.result} sending={props.sending} onAsk={props.onAsk} />
      {props.result ? (
        <p className="career-diary-consultant-response">{props.result.message}</p>
      ) : null}
      <DiaryProposalList
        proposals={props.proposals}
        turnIdempotencyKey={props.turnIdempotencyKey}
        onPrepared={props.onPrepared}
      />
      <DiaryProposalFeedback
        result={props.result}
        proposalCount={props.proposals.length}
        error={props.error}
        sending={props.sending}
        onRetry={props.onRetry}
      />
    </section>
  );
}

function DiaryProposalActionFeedback({
  status,
  error,
}: {
  readonly status: CareerCommand['status'] | undefined;
  readonly error: string | undefined;
}) {
  if (!error && status !== 'awaiting_approval') return null;
  return (
    <>
      {status === 'awaiting_approval' ? (
        <p className="career-diary-note" role="status">
          Правка подготовлена. Откройте «Профиль», чтобы принять предложение или отклонить его.
        </p>
      ) : null}
      {error ? (
        <p className="career-diary-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function useDiaryProfileProposalAction({
  proposalIndex,
  turnIdempotencyKey,
  onPrepared,
}: {
  readonly proposalIndex: number;
  readonly turnIdempotencyKey: string;
  readonly onPrepared: () => void;
}) {
  const idempotencyKey = useRef(crypto.randomUUID());
  const [command, setCommand] = useState<CareerCommand>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function prepare(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      setCommand(
        await prepareCareerCommand({
          turnIdempotencyKey,
          proposalIndex,
          idempotencyKey: idempotencyKey.current,
        }),
      );
      onPrepared();
    } catch {
      setError('Не удалось подготовить профильную правку. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  async function refresh(): Promise<void> {
    if (!command) return;
    setBusy(true);
    try {
      setCommand(await getCareerCommand(command.commandId));
    } catch {
      setError('Не удалось обновить статус правки.');
    } finally {
      setBusy(false);
    }
  }

  return { command, busy, error, prepare, refresh };
}

function DiaryProfileProposalAction({
  proposal,
  proposalIndex,
  turnIdempotencyKey,
  onPrepared,
}: {
  readonly proposal: CoachResult['actionProposals'][number];
  readonly proposalIndex: number;
  readonly turnIdempotencyKey: string;
  readonly onPrepared: () => void;
}) {
  const action = useDiaryProfileProposalAction({
    proposalIndex,
    turnIdempotencyKey,
    onPrepared,
  });

  return (
    <div className="career-diary-profile-proposal__action career-action-proposals">
      <CareerActionProposalCard
        proposal={proposal}
        command={action.command}
        busy={action.busy}
        onPrepare={() => void action.prepare()}
        onApprove={() => undefined}
        onRefresh={() => void action.refresh()}
      />
      <DiaryProposalActionFeedback status={action.command?.status} error={action.error} />
    </div>
  );
}
