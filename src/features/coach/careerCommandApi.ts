import { apiFetch, readDataArray, readDataObject } from './apiClient';
import type { CareerCommand } from './coachApi';

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
