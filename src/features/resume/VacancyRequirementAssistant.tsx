import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { addManualExperienceFact } from './experienceFactApi';
import {
  hasConfirmedExperienceEvidence,
  groundedExperienceProposalIndex,
} from './vacancyRequirementSuggestion';
import type { ResumeDraft, ResumeExperienceInput } from './resumeTypes';
import type { CandidateMemory } from '../coach/coachApi';
import { sendCoachTurn } from '../coach/coachApi';
import { prepareCareerCommand } from '../coach/careerCommandApi';
import type { VacancyProfileRequirementRequest } from '../vacancies/vacancyProfileRequirement';
import { extractSeniorityLevelFromPoint, LEVEL_HUMAN_NAMES } from '../vacancies/vacancyLevel';

interface VacancyRequirementAssistantProps {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
  readonly request: VacancyProfileRequirementRequest;
  readonly onHandled: () => void;
  readonly onSuggestionPrepared: (commandId: string) => Promise<void> | void;
  readonly onManualFactAdded: () => Promise<void> | void;
}

interface ManualFactFormProps {
  readonly draft: ResumeDraft;
  readonly hasConfirmedEvidence: boolean;
  readonly onHandled: () => void;
  readonly onRequestHandled: () => void;
  readonly onFactAdded: () => Promise<void> | void;
}

type AssistantMode = 'checking' | 'manual';

function requirementPrompt(request: VacancyProfileRequirementRequest): string {
  return [
    `Для вакансии «${request.vacancyTitle}» отсутствует требование: «${request.requirement}».`,
    'Проверь только подтверждённые факты в блоке «Опыт».',
    'Если существующий факт прямо подтверждает требование, подготовь resume.revise для этого факта.',
    'Укажи experienceId и memoryId именно из resumeContext.bulletMemoryIds, добавь memory:<id> в evidenceRefs.',
    'Не придумывай опыт, навыки, метрики или результаты. Если подтверждения нет, не предлагай правку.',
  ].join(' ');
}

function requestError(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  return 'Не удалось подготовить факт. Добавьте подтверждение вручную.';
}

async function prepareRequirementSuggestion(
  request: VacancyProfileRequirementRequest,
  draft: ResumeDraft,
  memory: readonly CandidateMemory[],
): Promise<string | undefined> {
  const result = await sendCoachTurn({
    content: requirementPrompt(request),
    idempotencyKey: request.requestId,
    messageId: request.requestId,
  });
  const proposalIndex = groundedExperienceProposalIndex(result, draft, memory);
  if (proposalIndex === undefined) return undefined;
  const command = await prepareCareerCommand({
    turnIdempotencyKey: request.requestId,
    proposalIndex,
    idempotencyKey: request.requestId,
  });
  return command.commandId;
}

function useRequirementProposal({
  draft,
  memory,
  request,
  onHandled,
  onSuggestionPrepared,
}: VacancyRequirementAssistantProps) {
  const hasEvidence = hasConfirmedExperienceEvidence(draft, memory);
  const [mode, setMode] = useState<AssistantMode>(hasEvidence ? 'checking' : 'manual');
  const [error, setError] = useState<string>();
  const completedRequestIds = useRef(new Set<string>());
  const markRequestHandled = useCallback(() => {
    completedRequestIds.current.add(request.requestId);
  }, [request.requestId]);

  useEffect(() => {
    let active = true;
    if (!hasEvidence || completedRequestIds.current.has(request.requestId)) {
      completedRequestIds.current.add(request.requestId);
      setMode('manual');
      return () => {
        active = false;
      };
    }
    setMode('checking');
    setError(undefined);
    void prepareRequirementSuggestion(request, draft, memory)
      .then(async (prepared) => {
        if (!active) return;
        completedRequestIds.current.add(request.requestId);
        if (!prepared) {
          setMode('manual');
          return;
        }
        await onSuggestionPrepared(prepared);
        if (active) onHandled();
      })
      .catch((reason: unknown) => {
        if (!active) return;
        completedRequestIds.current.add(request.requestId);
        setError(requestError(reason));
        setMode('manual');
      });
    return () => {
      active = false;
    };
  }, [draft, hasEvidence, memory, onHandled, onSuggestionPrepared, request]);

  return { mode, error, hasEvidence, markRequestHandled };
}

function useManualFactSubmission({
  draft,
  onHandled,
  onRequestHandled,
  onFactAdded,
}: ManualFactFormProps) {
  const [statement, setStatement] = useState('');
  const [experienceId, setExperienceId] = useState(draft.experience[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const attempt = useRef<{
    statement: string;
    experienceId: string;
    idempotencyKey: string;
  }>();

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const clean = statement.trim();
      if (!clean || busy) return;
      const currentAttempt =
        attempt.current?.statement === clean && attempt.current.experienceId === experienceId
          ? attempt.current
          : { statement: clean, experienceId, idempotencyKey: crypto.randomUUID() };
      attempt.current = currentAttempt;
      onRequestHandled();
      setBusy(true);
      setError(undefined);
      try {
        await addManualExperienceFact({
          statement: clean,
          experienceId: experienceId || undefined,
          idempotencyKey: currentAttempt.idempotencyKey,
        });
        await onFactAdded();
        onHandled();
      } catch (reason) {
        setError(requestError(reason));
      } finally {
        setBusy(false);
      }
    },
    [busy, experienceId, onFactAdded, onHandled, onRequestHandled, statement],
  );

  return { statement, setStatement, experienceId, setExperienceId, busy, error, submit };
}

function ExperiencePicker({
  experiences,
  value,
  onChange,
}: {
  readonly experiences: readonly ResumeExperienceInput[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  if (!experiences.length) return null;
  return (
    <label className="career-profile-screen-field">
      <span>Место работы</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Без отдельного места работы</option>
        {experiences.map((experience) => (
          <option key={experience.id} value={experience.id}>
            {[experience.title, experience.employer].filter(Boolean).join(' · ') || 'Место работы'}
          </option>
        ))}
      </select>
    </label>
  );
}

function ManualFactForm(props: ManualFactFormProps) {
  const { draft, hasConfirmedEvidence, onHandled } = props;
  const { statement, setStatement, experienceId, setExperienceId, busy, error, submit } =
    useManualFactSubmission(props);
  return (
    <form onSubmit={submit}>
      <p>
        {hasConfirmedEvidence
          ? 'Не получилось подготовить предложение по подтверждённым фактам. Добавьте точную формулировку вручную.'
          : 'В профиле нет подтверждённого опыта для этого требования. Добавьте свой факт вручную.'}
      </p>
      <ExperiencePicker
        experiences={draft.experience}
        value={experienceId}
        onChange={setExperienceId}
      />
      <label className="career-profile-screen-field">
        <span>Что именно вы делали?</span>
        <textarea
          value={statement}
          onChange={(event) => setStatement(event.target.value)}
          rows={3}
          maxLength={1_000}
          required
        />
      </label>
      <div className="career-profile-screen-edit-actions">
        <button
          type="submit"
          className="career-primary-button"
          disabled={busy || !statement.trim()}
        >
          {busy ? 'Добавляем…' : 'Добавить факт в профиль'}
        </button>
        <button type="button" className="career-quiet-button" disabled={busy} onClick={onHandled}>
          Закрыть
        </button>
      </div>
      {error ? (
        <p className="career-command-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function VacancyRequirementAssistant(props: VacancyRequirementAssistantProps) {
  const { draft, request, onHandled, onManualFactAdded } = props;
  const { mode, error, hasEvidence, markRequestHandled } = useRequirementProposal(props);
  const seniorityLevel = extractSeniorityLevelFromPoint(request.requirement);
  return (
    <div className="career-vacancy-requirement-assistant">
      <p className="career-vacancy-requirement-label">
        {seniorityLevel ? (
          <>
            Уровень вакансии: <strong>{LEVEL_HUMAN_NAMES[seniorityLevel]}</strong>
          </>
        ) : (
          <>
            Требование вакансии: <strong>{request.requirement}</strong>
          </>
        )}
      </p>
      {mode === 'checking' ? <p role="status">Проверяем, подтверждает ли это ваш опыт.</p> : null}
      {mode === 'manual' ? (
        <ManualFactForm
          draft={draft}
          hasConfirmedEvidence={hasEvidence}
          onHandled={onHandled}
          onRequestHandled={markRequestHandled}
          onFactAdded={onManualFactAdded}
        />
      ) : null}
      {error ? (
        <p className="career-command-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
