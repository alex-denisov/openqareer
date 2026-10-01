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

  return {
    id: command.commandId,
    commandId: command.commandId,
    section: target.section,
    experienceId: target.experienceId,
    title: 'Предложение карьерного консультанта',
    rationale: command.proposal.objective,
    proposedText: target.proposedText,
    currentText: target.currentText ?? target.previousText,
    applied: command.status === 'completed_with_receipt',
  };
}

function useSuggestionsCommands(candidateId: string) {
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
  }, [load]);

  return { commands, loading, load };
}

export function useConsultantSuggestions(
  candidateId: string,
  onProfileUpdated?: () => Promise<void> | void,
) {
  const { commands, loading, load } = useSuggestionsCommands(candidateId);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const acceptSuggestion = useCallback(
    async (suggestion: InlineSuggestionItem) => {
      if (!suggestion.commandId) return;
      await approveCareerCommand(suggestion.commandId);
      await load();
      onProfileUpdated?.();
    },
    [load, onProfileUpdated],
  );

  const dismissSuggestion = useCallback(
    async (suggestion: InlineSuggestionItem) => {
      setDismissedIds((prev) => new Set([...prev, suggestion.id]));
      const key = computeProposalKey(suggestion.section, suggestion.proposedText);
      try {
        await rejectCoachProposal({ proposalKey: key });
      } catch {
        // Safe against transient error: dismissedIds keeps UI clean
      }
    },
    [],
  );

  const revertSuggestion = useCallback(
    async (suggestion: InlineSuggestionItem) => {
      if (!suggestion.commandId) return;
      await revertCareerCommand(suggestion.commandId);
      await load();
      onProfileUpdated?.();
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
