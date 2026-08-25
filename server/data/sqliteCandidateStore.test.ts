import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CandidateStoreConflictError } from './store/errors';
import {
  createCandidate,
  createStore,
  directories,
  output,
  stores,
  turnRequest,
} from './sqliteTestHarness';

describe('SQLite candidate memory', () => {
  it('isolates candidate tokens, messages and memory', () => {
    const store = createStore();
    const candidateA = createCandidate(store);
    const candidateB = createCandidate(store);

    expect(store.authenticate(candidateA.accessToken)?.id).toBe(candidateA.id);
    expect(store.authenticate(candidateB.accessToken)?.id).toBe(candidateB.id);
    expect(store.authenticate('oqc_invalid')).toBeNull();

    const started = store.startTurn(
      candidateA.id,
      '51df5f57-df61-4ac2-98af-202607310101',
      turnRequest,
    );
    expect(started.state).toBe('ready');
    store.completeTurn(
      candidateA.id,
      '51df5f57-df61-4ac2-98af-202607310101',
      output,
    );

    expect(store.getSnapshot(candidateA.id).messages).toHaveLength(2);
    expect(store.getSnapshot(candidateA.id).memory).toHaveLength(1);
    expect(store.getSnapshot(candidateA.id).dossier.sections[0]).toMatchObject({
      domain: 'responsibility',
    });
    expect(store.getSnapshot(candidateB.id).messages).toEqual([]);
    expect(store.getSnapshot(candidateB.id).memory).toEqual([]);
    const memoryId = store.getSnapshot(candidateA.id).memory[0].id;
    expect(
      store.changeMemory(candidateB.id, memoryId, { action: 'confirm' }),
    ).toBeNull();
  });

  it('persists input before provider completion and retries idempotently', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const idempotencyKey = '51df5f57-df61-4ac2-98af-202607310102';

    store.startTurn(candidate.id, idempotencyKey, turnRequest);
    store.failTurn(candidate.id, idempotencyKey, 'provider_timeout');
    expect(store.getSnapshot(candidate.id).messages).toEqual([
      {
        id: turnRequest.messageId,
        role: 'user',
        content: turnRequest.content,
      },
    ]);

    const retry = store.startTurn(candidate.id, idempotencyKey, turnRequest);
    expect(retry.state).toBe('ready');
    expect(store.getSnapshot(candidate.id).messages).toHaveLength(1);
    store.completeTurn(candidate.id, idempotencyKey, output);

    const cached = store.startTurn(candidate.id, idempotencyKey, turnRequest);
    expect(cached).toMatchObject({
      state: 'completed',
      output: {
        provider: 'openrouter',
        responseId: 'response-1',
      },
    });
    expect(store.getSnapshot(candidate.id).messages).toHaveLength(2);
    expect(() =>
      store.startTurn(candidate.id, idempotencyKey, {
        ...turnRequest,
        content: 'Другой ввод под тем же ключом.',
      }),
    ).toThrow(CandidateStoreConflictError);
  });

  it('rejects market context added to a legacy turn without a request digest', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-turn-digest-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const store = createStore(databasePath);
    const candidate = createCandidate(store);
    const idempotencyKey = '51df5f57-df61-4ac2-98af-202607310109';
    store.startTurn(candidate.id, idempotencyKey, turnRequest);
    store.completeTurn(candidate.id, idempotencyKey, output);
    store.close();
    stores.splice(stores.indexOf(store), 1);

    const database = new DatabaseSync(databasePath);
    database
      .prepare('UPDATE turns SET request_digest = NULL WHERE idempotency_key = ?')
      .run(idempotencyKey);
    database.close();

    const reopened = createStore(databasePath);
    expect(() =>
      reopened.startTurn(candidate.id, idempotencyKey, {
        ...turnRequest,
        marketQuery: 'руководитель продукта',
      }),
    ).toThrow(CandidateStoreConflictError);
  });

  it('keeps memory changes explicit and supports candidate deletion', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const idempotencyKey = '51df5f57-df61-4ac2-98af-202607310103';
    store.startTurn(candidate.id, idempotencyKey, turnRequest);
    store.completeTurn(candidate.id, idempotencyKey, output);
    const memory = store.getSnapshot(candidate.id).memory[0];

    expect(
      store.changeMemory(candidate.id, memory.id, { action: 'confirm' }),
    ).toMatchObject({ status: 'confirmed' });
    expect(
      store.changeMemory(candidate.id, memory.id, {
        action: 'correct',
        statement: 'Кандидат подтвердил запуск B2B-продукта.',
      }),
    ).toMatchObject({
      status: 'corrected',
      statement: 'Кандидат подтвердил запуск B2B-продукта.',
    });
    expect(
      store.changeMemory(candidate.id, memory.id, { action: 'delete' }),
    ).toBeNull();
    expect(store.exportCandidate(candidate.id).memory).toEqual([]);

    expect(store.deleteCandidate(candidate.id)).toBe(true);
    expect(store.authenticate(candidate.accessToken)).toBeNull();
  });

  it('does not persist candidate plaintext in the database file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-store-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const store = createStore(databasePath);
    const candidate = createCandidate(store);
    store.startTurn(
      candidate.id,
      '51df5f57-df61-4ac2-98af-202607310104',
      {
        ...turnRequest,
        content: 'Уникальный секретный карьерный факт 731.',
      },
    );
    store.close();
    stores.splice(stores.indexOf(store), 1);

    expect(readFileSync(databasePath).toString('utf8')).not.toContain(
      'Уникальный секретный карьерный факт 731.',
    );
  });

  it('stores, deduplicates and soft-deletes an encrypted candidate document', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-documents-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const store = createStore(databasePath);
    const candidateA = createCandidate(store);
    const candidateB = createCandidate(store);
    const contentBase64 = Buffer.from(
      '%PDF synthetic private document bytes 482',
    ).toString('base64');
    const input = {
      kind: 'resume' as const,
      source: 'upload' as const,
      fileName: 'Мария Иванова CV.pdf',
      mimeType: 'application/pdf',
      contentBase64,
      extractedText: 'Уникальный текст резюме 482',
      parseStatus: 'ready' as const,
    };

    const first = store.saveDocument(candidateA.id, input);
    expect(first).toMatchObject({
      created: true,
      document: {
        kind: 'resume',
        source: 'upload',
        fileName: 'Мария Иванова CV.pdf',
        mimeType: 'application/pdf',
        version: 1,
        parseStatus: 'ready',
      },
    });
    expect(store.getDocument(candidateB.id, first.document.id)).toBeNull();
    expect(store.getDocument(candidateA.id, first.document.id)).toMatchObject({
      contentBase64,
      extractedText: 'Уникальный текст резюме 482',
    });
    expect(store.saveDocument(candidateA.id, input)).toMatchObject({
      created: false,
      document: { id: first.document.id },
    });
    expect(store.getSnapshot(candidateA.id).documents).toHaveLength(1);
    expect(store.getSnapshot(candidateB.id).documents).toEqual([]);
    expect(store.exportCandidate(candidateA.id).documentContents).toMatchObject([
      { id: first.document.id, contentBase64 },
    ]);

    store.close();
    stores.splice(stores.indexOf(store), 1);
    const rawDatabase = readFileSync(databasePath).toString('utf8');
    expect(rawDatabase).not.toContain('Мария Иванова CV.pdf');
    expect(rawDatabase).not.toContain('Уникальный текст резюме 482');
    expect(rawDatabase).not.toContain('%PDF synthetic private document bytes 482');

    const reopened = createStore(databasePath);
    expect(reopened.deleteDocument(candidateA.id, first.document.id)).toBe(true);
    expect(reopened.getDocument(candidateA.id, first.document.id)).toBeNull();
    expect(reopened.getSnapshot(candidateA.id).documents).toEqual([]);
  });

  it('projects confirmed knowledge and bounded document excerpts into a coach turn', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const firstTurnId = '51df5f57-df61-4ac2-98af-202607310112';
    store.startTurn(candidate.id, firstTurnId, turnRequest);
    store.completeTurn(candidate.id, firstTurnId, output);
    const memory = store.getSnapshot(candidate.id).memory[0]!;
    store.changeMemory(candidate.id, memory.id, { action: 'confirm' });
    const document = store.saveDocument(candidate.id, {
      kind: 'resume',
      source: 'upload',
      fileName: 'candidate.pdf',
      mimeType: 'application/pdf',
      contentBase64: Buffer.from('%PDF coach context').toString('base64'),
      extractedText: `Подтверждённый фрагмент CV. ${'A'.repeat(8_000)}`,
      parseStatus: 'ready',
    }).document;

    const next = store.startTurn(
      candidate.id,
      '51df5f57-df61-4ac2-98af-202607310113',
      {
        messageId: '0e59bb5c-8d83-4d63-b75c-e0fe9e9d8320',
        content: 'Помоги выбрать следующий карьерный шаг.',
        phase: 'role',
      },
    );

    expect(next).toMatchObject({
      state: 'ready',
      input: {
        knowledgeContext: {
          confirmedFacts: [
            {
              ref: `memory:${memory.id}`,
              statement: output.result.memoryCandidates[0]?.statement,
              domain: 'responsibility',
            },
          ],
          documents: [
            {
              ref: `document:${document.id}`,
              fileName: 'candidate.pdf',
              kind: 'resume',
            },
          ],
        },
      },
    });
    if (next.state !== 'ready') throw new Error('expected ready turn');
    expect(next.input.knowledgeContext.documents[0]?.excerpt.length).toBeLessThanOrEqual(
      6_000,
    );
    expect(JSON.stringify(next.input.knowledgeContext)).not.toContain(
      Buffer.from('%PDF coach context').toString('base64'),
    );
  });

  it('invalidates confirmed knowledge when its only document source is deleted', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const document = store.saveDocument(candidate.id, {
      kind: 'resume',
      source: 'upload',
      fileName: 'source.pdf',
      mimeType: 'application/pdf',
      contentBase64: Buffer.from('%PDF provenance source').toString('base64'),
      extractedText: 'Подтверждённый опыт управления операциями.',
      parseStatus: 'ready',
    }).document;
    const documentRef = `document:${document.id}`;
    const derivedOutput = structuredClone(output);
    derivedOutput.result.memoryCandidates[0]!.sourceMessageIds = [documentRef];
    const firstTurnId = '51df5f57-df61-4ac2-98af-202608130201';
    store.startTurn(candidate.id, firstTurnId, turnRequest);
    store.completeTurn(candidate.id, firstTurnId, derivedOutput);
    const memory = store.getSnapshot(candidate.id).memory[0]!;
    store.changeMemory(candidate.id, memory.id, { action: 'confirm' });

    expect(store.deleteDocument(candidate.id, document.id)).toBe(true);
    expect(store.getSnapshot(candidate.id).memory[0]).toMatchObject({
      id: memory.id,
      status: 'proposed',
      sourceMessageIds: [`deleted-document:${document.id}`],
    });

    const next = store.startTurn(
      candidate.id,
      '51df5f57-df61-4ac2-98af-202608130202',
      {
        ...turnRequest,
        messageId: '85512ddf-962c-4a7c-a4cc-30a35d1e6802',
      },
    );
    if (next.state !== 'ready') throw new Error('expected ready turn');
    expect(next.input.knowledgeContext.confirmedFacts).toEqual([]);
    expect(next.input.knowledgeContext.documents).toEqual([]);

    expect(
      store.changeMemory(candidate.id, memory.id, { action: 'confirm' }),
    ).toMatchObject({
      status: 'confirmed',
      sourceMessageIds: [expect.stringMatching(/^candidate-review:/u)],
    });
    const afterReview = store.startTurn(
      candidate.id,
      '51df5f57-df61-4ac2-98af-202608130203',
      {
        ...turnRequest,
        messageId: '85512ddf-962c-4a7c-a4cc-30a35d1e6803',
      },
    );
    if (afterReview.state !== 'ready') throw new Error('expected ready turn');
    expect(afterReview.input.knowledgeContext.confirmedFacts[0]).toMatchObject({
      ref: `memory:${memory.id}`,
      sourceRefs: [expect.stringMatching(/^candidate-review:/u)],
    });
  });

  it('purges an explicitly expired document through provenance invalidation', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const otherCandidate = createCandidate(store);
    const document = store.saveDocument(candidate.id, {
      kind: 'resume',
      source: 'upload',
      fileName: 'retained-source.pdf',
      mimeType: 'application/pdf',
      contentBase64: Buffer.from('%PDF retained source').toString('base64'),
      extractedText: 'Опыт, подтверждённый временно хранимым источником.',
      parseStatus: 'ready',
    }).document;
    const derivedOutput = structuredClone(output);
    derivedOutput.result.memoryCandidates[0]!.sourceMessageIds = [
      `document:${document.id}`,
    ];
    const turnId = '51df5f57-df61-4ac2-98af-202608130211';
    store.startTurn(candidate.id, turnId, turnRequest);
    store.completeTurn(candidate.id, turnId, derivedOutput);
    const memory = store.getSnapshot(candidate.id).memory[0]!;
    store.changeMemory(candidate.id, memory.id, { action: 'confirm' });

    expect(
      store.setDocumentRetention(
        otherCandidate.id,
        document.id,
        '2026-09-01T00:00:00.000Z',
        '2026-08-13T10:00:00.000Z',
      ),
    ).toBeNull();
    expect(
      store.setDocumentRetention(
        candidate.id,
        document.id,
        '2026-09-01T00:00:00.000Z',
        '2026-08-13T10:00:00.000Z',
      ),
    ).toMatchObject({
      id: document.id,
      retentionUntil: '2026-09-01T00:00:00.000Z',
    });
    expect(
      store.purgeExpiredDocuments('2026-08-31T23:59:59.999Z', 100),
    ).toBe(0);
    expect(
      store.purgeExpiredDocuments('2026-09-01T00:00:00.000Z', 100),
    ).toBe(1);
    expect(store.getDocument(candidate.id, document.id)).toBeNull();
    expect(store.getSnapshot(candidate.id).memory[0]).toMatchObject({
      id: memory.id,
      status: 'proposed',
      sourceMessageIds: [`deleted-document:${document.id}`],
    });
  });


});
