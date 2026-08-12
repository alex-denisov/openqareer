import { useEffect, useState } from 'react';
import {
  approveCareerCommand,
  CoachApiError,
  getCareerCommand,
  getCareerCommands,
  prepareCareerCommand,
  type CareerCommand,
  type CoachResult,
} from '../coach/coachApi';

interface CareerActionProposalListProps {
  proposals: CoachResult['actionProposals'];
  turnIdempotencyKey?: string;
}

interface CareerActionProposalCardProps {
  proposal: CoachResult['actionProposals'][number];
  command?: CareerCommand;
  busy: boolean;
  enabled?: boolean;
  onPrepare: () => void;
  onApprove: () => void;
  onRefresh: () => void;
}

interface CommandActionProps {
  command?: CareerCommand;
  busy: boolean;
  enabled: boolean;
  externalWrite: boolean;
  onPrepare: () => void;
  onApprove: () => void;
  onRefresh: () => void;
}

function useCareerCommandState({
  proposals,
  turnIdempotencyKey,
}: CareerActionProposalListProps) {
  const [commands, setCommands] = useState<Record<number, CareerCommand>>({});
  const [busyIndex, setBusyIndex] = useState<number>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!turnIdempotencyKey) {
      setCommands({});
      return;
    }
    let active = true;
    void getCareerCommands()
      .then((stored) => {
        if (!active) return;
        const turnCommands = stored.filter(
          (command) =>
            command.provenance?.strategyDecisionId === turnIdempotencyKey,
        );
        setCommands(matchCommandsToProposals(turnCommands, proposals));
      })
      .catch((reason) => {
        if (active) setError(commandErrorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [proposals, turnIdempotencyKey]);

  async function runCommandAction(
    index: number,
    action: () => Promise<CareerCommand>,
  ) {
    setBusyIndex(index);
    setError(undefined);
    try {
      const command = await action();
      setCommands((current) => ({ ...current, [index]: command }));
    } catch (reason) {
      setError(commandErrorMessage(reason));
    } finally {
      setBusyIndex(undefined);
    }
  }

  return { commands, busyIndex, error, runCommandAction };
}

export function CareerActionProposalList({
  proposals,
  turnIdempotencyKey,
}: CareerActionProposalListProps) {
  const { commands, busyIndex, error, runCommandAction } =
    useCareerCommandState({ proposals, turnIdempotencyKey });

  return (
    <div className="career-action-proposals">
      <span>Следующие задания</span>
      {proposals.map((proposal, index) => (
        <CareerActionProposalItem
          key={`${proposal.kind}-${index}`}
          proposal={proposal}
          index={index}
          command={commands[index]}
          busy={busyIndex === index}
          turnIdempotencyKey={turnIdempotencyKey}
          onRun={runCommandAction}
        />
      ))}
      {error ? (
        <p className="career-command-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CareerActionProposalItem({
  proposal,
  index,
  command,
  busy,
  turnIdempotencyKey,
  onRun,
}: {
  proposal: CoachResult['actionProposals'][number];
  index: number;
  command?: CareerCommand;
  busy: boolean;
  turnIdempotencyKey?: string;
  onRun: (index: number, action: () => Promise<CareerCommand>) => Promise<void>;
}) {
  return (
    <CareerActionProposalCard
      proposal={proposal}
      command={command}
      busy={busy}
      enabled={Boolean(turnIdempotencyKey)}
      onPrepare={() => {
        if (!turnIdempotencyKey) return;
        void onRun(index, () =>
          prepareCareerCommand({ turnIdempotencyKey, proposalIndex: index }),
        );
      }}
      onApprove={() => {
        if (!command) return;
        void onRun(index, () => approveCareerCommand(command.commandId));
      }}
      onRefresh={() => {
        if (!command) return;
        void onRun(index, () => getCareerCommand(command.commandId));
      }}
    />
  );
}

export function CareerActionProposalCard({
  proposal,
  command,
  busy,
  enabled = true,
  onPrepare,
  onApprove,
  onRefresh,
}: CareerActionProposalCardProps) {
  const externalWrite = proposal.risk === 'external_side_effect';
  const status = commandStatus(command, externalWrite);
  return (
    <article className="career-action-proposal">
      <div>
        <strong>{actionLabel(proposal.kind)}</strong>
        <small>{status.label}</small>
      </div>
      <p>{proposal.objective}</p>
      <small>
        Сигнал: {proposal.expectedSignal} · проверка{' '}
        {formatDate(proposal.measureAfter)}
      </small>
      {status.detail ? (
        <p className="career-command-status" role="status">
          {status.detail}
        </p>
      ) : null}
      {command?.execution?.connector?.providerReference ? (
        <small className="career-command-receipt">
          Receipt: {command.execution.connector.providerReference}
        </small>
      ) : null}
      <CommandAction
        command={command}
        busy={busy}
        enabled={enabled}
        externalWrite={externalWrite}
        onPrepare={onPrepare}
        onApprove={onApprove}
        onRefresh={onRefresh}
      />
    </article>
  );
}

function CommandAction({
  command,
  busy,
  enabled,
  externalWrite,
  onPrepare,
  onApprove,
  onRefresh,
}: CommandActionProps) {
  if (!enabled) return null;
  if (!command) {
    const label = externalWrite
      ? 'Подготовить к подтверждению'
      : 'Сохранить задание';
    return (
      <button type="button" disabled={busy} onClick={onPrepare}>
        {busy ? 'Сохраняем…' : label}
      </button>
    );
  }
  if (command.status === 'awaiting_approval') {
    return (
      <button type="button" disabled={busy} onClick={onApprove}>
        {busy ? 'Подтверждаем…' : 'Подтвердить отправку'}
      </button>
    );
  }
  if (['queued', 'executing', 'paused'].includes(command.status)) {
    return (
      <button type="button" disabled={busy} onClick={onRefresh}>
        {busy ? 'Проверяем…' : 'Обновить статус'}
      </button>
    );
  }
  return null;
}

function matchCommandsToProposals(
  commands: CareerCommand[],
  proposals: CoachResult['actionProposals'],
): Record<number, CareerCommand> {
  const matched: Record<number, CareerCommand> = {};
  const remaining = [...commands];
  proposals.forEach((proposal, index) => {
    const commandIndex = remaining.findIndex(
      (command) => proposalKey(command.proposal) === proposalKey(proposal),
    );
    if (commandIndex < 0) return;
    matched[index] = remaining[commandIndex];
    remaining.splice(commandIndex, 1);
  });
  return matched;
}

function proposalKey(proposal: CoachResult['actionProposals'][number]): string {
  return JSON.stringify([
    proposal.kind,
    proposal.objective,
    proposal.expectedSignal,
    proposal.measureAfter,
    proposal.evidenceRefs,
  ]);
}

function commandStatus(
  command: CareerCommand | undefined,
  externalWrite: boolean,
): { label: string; detail: string | null } {
  if (!command) return proposedStatus(externalWrite);
  return commandStatuses[command.status];
}

function proposedStatus(externalWrite: boolean) {
  return {
    label: externalWrite
      ? 'Требует вашего подтверждения'
      : 'Предложено · ещё не запущено',
    detail: null,
  };
}

const commandStatuses: Record<
  CareerCommand['status'],
  { label: string; detail: string }
> = {
  awaiting_approval: {
    label: 'Требует вашего подтверждения',
    detail: 'Ничего не отправлено. Проверьте цель и подтвердите одно действие.',
  },
  prepared: {
    label: 'Задание сохранено',
    detail: 'Подготовлено внутри OpenQareer, внешнего действия не было.',
  },
  queued: {
    label: 'Подтверждено',
    detail: 'Ожидает безопасного исполнителя. Это ещё не результат площадки.',
  },
  executing: {
    label: 'Проверяем исполнение',
    detail: 'Не закрывайте как выполненное до receipt площадки.',
  },
  completed_with_receipt: {
    label: 'Выполнено с подтверждением площадки',
    detail: 'Результат подтверждён совпавшим receipt.',
  },
  paused: {
    label: 'Приостановлено',
    detail: 'Автоповтор отключён. Нужна ручная проверка состояния площадки.',
  },
  failed: {
    label: 'Не выполнено',
    detail: 'Подтверждённого результата площадки нет.',
  },
  native_handoff: {
    label: 'Продолжите на площадке',
    detail: 'Финальное действие и проверка остаются у вас.',
  },
};

function actionLabel(kind: CoachResult['actionProposals'][number]['kind']) {
  return {
    'resume.draft': 'Подготовить резюме',
    'resume.revise': 'Улучшить резюме',
    'vacancies.search': 'Найти вакансии',
    'vacancies.local_query': 'Проверить локальную базу вакансий',
    'company.evaluate': 'Оценить компанию',
    'market.evaluate': 'Оценить рынок',
    'cover_letter.draft': 'Подготовить сопроводительное',
    'application.prepare': 'Подготовить отклик',
    'application.submit': 'Отправить отклик',
    'outreach.prepare': 'Подготовить личный контакт',
    'outreach.send': 'Отправить сообщение',
    'connection.request': 'Запросить контакт',
  }[kind];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${value}T00:00:00Z`));
}

function commandErrorMessage(reason: unknown): string {
  if (reason instanceof CoachApiError) return reason.message;
  if (reason instanceof Error) return reason.message;
  return 'Не удалось обновить задание. Попробуйте ещё раз.';
}
