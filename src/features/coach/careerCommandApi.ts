import { apiFetch, readDataArray, readDataObject } from './apiClient';
import type { CareerCommand } from './coachApi';
import type {
  QuizEvaluationResult,
  SkillVerificationFact,
} from '../../services/hhSkillQuizzes';

export interface SkillQuizApplyResponse {
  readonly commandId: string;
  readonly command: CareerCommand;
  readonly result: QuizEvaluationResult;
  readonly fact: SkillVerificationFact;
}

export async function applySkillQuizResult(input: {
  readonly quizId: string;
  readonly skillName: string;
  readonly answers: Readonly<Record<string, number>>;
  readonly idempotencyKey: string;
}): Promise<SkillQuizApplyResponse> {
  const response = await apiFetch('/api/v1/candidate/skill-quiz/apply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      quizId: input.quizId,
      skillName: input.skillName,
      answers: input.answers,
    }),
  });
  return readDataObject<SkillQuizApplyResponse>(response);
}

export async function prepareCareerCommand(input: {
  turnIdempotencyKey: string;
  proposalIndex: number;
  idempotencyKey?: string;
  executionTarget?: unknown;
}): Promise<CareerCommand> {
  const response = await apiFetch('/api/v1/candidate/career-commands', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey ?? crypto.randomUUID(),
    },
    body: JSON.stringify({
      turnIdempotencyKey: input.turnIdempotencyKey,
      proposalIndex: input.proposalIndex,
      ...(input.executionTarget ? { executionTarget: input.executionTarget } : {}),
    }),
  });
  return readDataObject(response);
}

export async function approveCareerCommand(
  commandId: string,
  input: { idempotencyKey?: string } = {},
): Promise<CareerCommand> {
  const response = await apiFetch(
    `/api/v1/candidate/career-commands/${encodeURIComponent(commandId)}/approvals`,
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': input.idempotencyKey ?? commandId,
      },
    },
  );
  return readDataObject(response);
}

export async function revertCareerCommand(commandId: string): Promise<CareerCommand> {
  const response = await apiFetch(
    `/api/v1/candidate/career-commands/${encodeURIComponent(commandId)}/revert`,
    { method: 'POST' },
  );
  return readDataObject(response);
}

export async function getCareerCommand(commandId: string): Promise<CareerCommand> {
  const response = await apiFetch(
    `/api/v1/candidate/career-commands/${encodeURIComponent(commandId)}`,
  );
  return readDataObject(response);
}

export async function getCareerCommands(): Promise<CareerCommand[]> {
  const response = await apiFetch('/api/v1/candidate/career-commands');
  return readDataArray<CareerCommand>(response);
}
