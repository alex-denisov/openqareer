import type { CandidateSnapshot } from './coachApi';
import { CoachApiError as CoachApiErrorClass, apiFetch, throwApiError } from './apiClient';

/**
 * Снимок кандидата читается частями.
 *
 * Целиком он до браузера не доезжает: маршрут обрывает ответ примерно на
 * 20 460 байт, и кабинет рисовался пустым при полной базе (INC-030). Голова
 * снимка, память, ходы и диалог — четыре ответа, каждый из которых доходит.
 */

interface SnapshotHeadEnvelope {
  data?: unknown;
  meta?: { memory?: { nextOffset?: unknown }; turns?: { nextOffset?: unknown } };
}

async function readSnapshotPage(
  memoryOffset: number,
): Promise<{
  snapshot: CandidateSnapshot;
  nextMemoryOffset: number | null;
  nextTurnOffset: number | null;
}> {
  const response = await apiFetch(
    `/api/v1/candidate/me?memoryOffset=${encodeURIComponent(String(memoryOffset))}`,
  );
  if (!response.ok) {
    await throwApiError(response);
  }
  const envelope = (await response.json()) as SnapshotHeadEnvelope;
  if (envelope.data === null || typeof envelope.data !== 'object') {
    throw new CoachApiErrorClass('Ответ сервиса не разобран.', 'malformed_response', false);
  }
  const nextOffset = envelope.meta?.memory?.nextOffset;
  const nextTurn = envelope.meta?.turns?.nextOffset;
  return {
    snapshot: envelope.data as CandidateSnapshot,
    nextMemoryOffset: typeof nextOffset === 'number' ? nextOffset : null,
    nextTurnOffset: typeof nextTurn === 'number' ? nextTurn : null,
  };
}

/**
 * Снимок приходит частями: целиком он не доезжает до браузера — маршрут рвёт
 * ответ примерно на 20 КБ, и кабинет оставался пустым при полной базе
 * (INC-030). Память дочитывается страницами, диалог живёт отдельным чтением.
 */
async function readTurnPage(offset: number): Promise<CandidateSnapshot['turns']> {
  const response = await apiFetch(
    `/api/v1/candidate/me/turns?offset=${encodeURIComponent(String(offset))}`,
  );
  if (!response.ok) {
    await throwApiError(response);
  }
  const envelope = (await response.json()) as { data?: unknown };
  if (!Array.isArray(envelope.data)) {
    throw new CoachApiErrorClass('Ответ сервиса не разобран.', 'malformed_response', false);
  }
  // Страница ходов идёт от свежего к старому; экраны читают ленту как есть.
  return [...(envelope.data as CandidateSnapshot['turns'])].reverse();
}

async function readMemoryPage(
  offset: number,
): Promise<{ items: CandidateSnapshot['memory']; nextOffset: number | null }> {
  const response = await apiFetch(
    `/api/v1/candidate/me/memory?offset=${encodeURIComponent(String(offset))}`,
  );
  if (!response.ok) {
    await throwApiError(response);
  }
  const envelope = (await response.json()) as { data?: unknown; meta?: { nextOffset?: unknown } };
  if (!Array.isArray(envelope.data)) {
    throw new CoachApiErrorClass('Ответ сервиса не разобран.', 'malformed_response', false);
  }
  const nextOffset = envelope.meta?.nextOffset;
  return {
    items: envelope.data as CandidateSnapshot['memory'],
    nextOffset: typeof nextOffset === 'number' ? nextOffset : null,
  };
}

export async function getCandidate(): Promise<CandidateSnapshot> {
  const first = await readSnapshotPage(0);
  const memory = [...first.snapshot.memory];
  let offset = first.nextMemoryOffset;
  let pages = 1;

  while (offset !== null && pages < 60) {
    const next = await readMemoryPage(offset);
    if (next.items.length === 0) break;
    memory.push(...next.items);
    offset = next.nextOffset;
    pages += 1;
  }

  // Свежий ход бывает больше целого ответа — тогда снимок приходит без ходов,
  // и разбор дочитывается своей страницей, а не пропадает с экрана (INC-030).
  const turns =
    first.snapshot.turns.length === 0 && first.nextTurnOffset !== null
      ? await readTurnPage(first.nextTurnOffset)
      : first.snapshot.turns;

  return { ...first.snapshot, memory, turns };
}

/** Снимок вместе с диалогом — его просит только панель эксперта. */
export async function getCandidateWithMessages(): Promise<CandidateSnapshot> {
  const [snapshot, messages] = await Promise.all([getCandidate(), getCandidateMessages()]);
  return { ...snapshot, messages };
}

export interface CandidateMessagePage {
  readonly items: CandidateSnapshot['messages'];
  readonly nextOffset: number | null;
}

export async function getCandidateMessagePage(offset = 0): Promise<CandidateMessagePage> {
  const response = await apiFetch(
    `/api/v1/candidate/me/messages?offset=${encodeURIComponent(String(offset))}`,
  );
  if (!response.ok) {
    await throwApiError(response);
  }
  const envelope = (await response.json()) as {
    data?: unknown;
    meta?: { nextOffset?: unknown };
  };
  if (!Array.isArray(envelope.data)) {
    throw new CoachApiErrorClass('Ответ сервиса не разобран.', 'malformed_response', false);
  }
  const nextOffset = envelope.meta?.nextOffset;
  return {
    items: envelope.data as CandidateSnapshot['messages'],
    nextOffset: typeof nextOffset === 'number' ? nextOffset : null,
  };
}

/** Весь диалог кандидата — страницами, как и всё, что не влезает в ответ. */
export async function getCandidateMessages(): Promise<CandidateSnapshot['messages']> {
  const items: CandidateSnapshot['messages'] = [];
  let offset: number | null = 0;
  let pages = 0;
  while (offset !== null && pages < 60) {
    const page: CandidateMessagePage = await getCandidateMessagePage(offset);
    if (page.items.length === 0) break;
    items.push(...page.items);
    offset = page.nextOffset;
    pages += 1;
  }
  return items;
}
