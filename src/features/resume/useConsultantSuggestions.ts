import { useCallback, useEffect, useState } from 'react';
import { rejectCoachProposal, type CareerCommand } from '../coach/coachApi';
import { computeProposalKey } from '../../../shared/consultantProposalKey';
import {
  approveCareerCommand,
  getCareerCommands,
  revertCareerCommand,
} from '../coach/careerCommandApi';
import type { InlineSuggestionItem } from './InlineConsultantSuggestion';

function commandToSuggestion(command: CareerCommand): InlineSuggestionItem | null {
  if (
    command.capability !== 'resume.revise' ||
    command.profileRevisionReverted ||
    command.status === 'failed'
  ) {
    return null;
  }
  const target = command.executionTarget;
  if (!target || !target.section || !target.proposedText) return null;
  const sourceFromDiary = command.provenance?.evidenceRefs.some((ref) => ref.startsWith('diary:'));

  return {
    id: command.commandId,
    commandId: command.commandId,
    section: target.section,
    experienceId: target.experienceId,
    field: target.field,
    title: sourceFromDiary
      ? 'Предложение из карьерного дневника'
      : 'Предложение карьерного консультанта',
    rationale: command.proposal.objective,
    proposedText: target.proposedText,
    currentText: target.currentText ?? target.previousText,
    applied: command.status === 'completed_with_receipt',
  };
}

function useSuggestionsCommands(candidateId: string, refreshKey?: number) {
  const [commands, setCommands] = useState<CareerCommand[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!candidateId) return;
    setLoading(true);
    try {
      setCommands(await getCareerCommands());
    } catch {
      // Background suggestions load failures shouldn't block profile
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return { commands, loading, load };
}

async function applySuggestionCommand(suggestion: InlineSuggestionItem): Promise<void> {
  if (!suggestion.commandId) {
    throw new Error('Не удалось принять предложение: отсутствует идентификатор команды.');
  }
  const command = await approveCareerCommand(suggestion.commandId);
  if (command.status !== 'completed_with_receipt') {
    throw new Error(`Предложение не применено: команда завершилась со статусом ${command.status}.`);
  }
}

async function rejectSuggestionProposal(suggestion: InlineSuggestionItem): Promise<void> {
  const key = computeProposalKey(suggestion.section, suggestion.proposedText, suggestion.field);
  const result = await rejectCoachProposal({ proposalKey: key });
  if (!result.ok || result.proposalKey !== key) {
    throw new Error('Сервер не подтвердил отклонение предложения. Карточка остаётся доступной.');
  }
}

async function revertSuggestionCommand(suggestion: InlineSuggestionItem): Promise<void> {
  if (!suggestion.commandId) {
    throw new Error('Не удалось откатить правку: отсутствует идентификатор команды.');
  }
  const command = await revertCareerCommand(suggestion.commandId);
  if (!command.profileRevisionReverted) {
    throw new Error('Откат не подтверждён сервером. Правка остаётся применённой.');
  }
}

export function useConsultantSuggestions(
  candidateId: string,
  onProfileUpdated?: () => Promise<void> | void,
  refreshKey?: number,
) {
  const { commands, loading, load } = useSuggestionsCommands(candidateId, refreshKey);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const acceptSuggestion = useCallback(
    async (suggestion: InlineSuggestionItem) => {
      await applySuggestionCommand(suggestion);
      await load();
      await onProfileUpdated?.();
    },
    [load, onProfileUpdated],
  );

  const dismissSuggestion = useCallback(async (suggestion: InlineSuggestionItem) => {
    await rejectSuggestionProposal(suggestion);
    setDismissedIds((prev) => new Set([...prev, suggestion.id]));
  }, []);

  const revertSuggestion = useCallback(
    async (suggestion: InlineSuggestionItem) => {
      await revertSuggestionCommand(suggestion);
      await load();
      await onProfileUpdated?.();
    },
    [load, onProfileUpdated],
  );

  const suggestions = commands
    .map(commandToSuggestion)
    .filter((s): s is InlineSuggestionItem => s !== null && !dismissedIds.has(s.id));

  return {
    suggestions,
    acceptSuggestion,
    dismissSuggestion,
    revertSuggestion,
    loading,
    reload: load,
  };
}
