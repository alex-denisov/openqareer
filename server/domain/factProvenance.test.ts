import { describe, expect, it } from 'vitest';
import {
  buildImportIndex,
  resolveFactProvenance,
  summarizeImportedSourcesWithKept,
  type ImportWalk,
} from './factProvenance';

const memory = (
  id: string,
  sourceMessageIds: string[],
  confidence:
    'candidate-reported' | 'candidate-confirmed' | 'coach-hypothesis' = 'candidate-reported',
) => ({ id, sourceMessageIds, confidence, createdAt: '2026-10-06T10:00:00.000Z' });

describe('resolveFactProvenance (B541)', () => {
  const index = buildImportIndex({
    native: [
      {
        platform: 'linkedin',
        lastImportedAt: '2026-09-12T08:00:00.000Z',
        receipt: { sourceMessageId: 'msg-li', memoryIds: ['a', 'b'], factCount: 2 },
      },
    ],
    recorded: [
      { messageId: 'msg-hh', platform: 'hh', importedAt: '2026-10-07T08:00:00.000Z', factCount: 3 },
      {
        messageId: 'msg-pdf',
        platform: 'file',
        importedAt: '2026-10-01T08:00:00.000Z',
        factCount: 1,
      },
    ],
    messages: [{ id: 'msg-legacy', content: 'Импорт: резюме hh.ru «cv.pdf»' }],
  });

  it('names the platform and date of the import the fact came from', () => {
    expect(resolveFactProvenance(memory('a', ['msg-li']), index)).toEqual({
      kind: 'import',
      platform: 'linkedin',
      at: '2026-09-12T08:00:00.000Z',
    });
    expect(resolveFactProvenance(memory('h', ['msg-hh']), index)).toMatchObject({
      platform: 'hh',
      at: '2026-10-07T08:00:00.000Z',
    });
    expect(resolveFactProvenance(memory('f', ['msg-pdf']), index)).toMatchObject({
      platform: 'file',
    });
  });

  it('reads a legacy import message whose platform was never recorded', () => {
    expect(resolveFactProvenance(memory('l', ['msg-legacy']), index)).toEqual({
      kind: 'import',
      platform: 'hh',
      at: '2026-10-06T10:00:00.000Z',
    });
  });

  it('tells a consultant inference from the candidate’s own words', () => {
    expect(resolveFactProvenance(memory('c', ['msg-chat'], 'coach-hypothesis'), index)).toEqual({
      kind: 'consultant',
      at: '2026-10-06T10:00:00.000Z',
    });
    expect(resolveFactProvenance(memory('u', ['msg-chat']), index)).toEqual({
      kind: 'candidate',
      at: '2026-10-06T10:00:00.000Z',
    });
  });

  it('does not invent an origin for a fact without any source', () => {
    expect(resolveFactProvenance(memory('x', []), index)).toBeUndefined();
  });
});

describe('summarizeImportedSourcesWithKept (B541)', () => {
  const walk: ImportWalk = {
    platform: 'linkedin',
    state: 'running',
    updatedAt: '2026-10-20T10:00:00.000Z',
    sections: [
      { key: 'experience', status: 'read' },
      { key: 'languages', status: 'pending' },
    ],
  };

  it('counts kept facts against everything the import brought', () => {
    const sources = summarizeImportedSourcesWithKept({
      native: [
        {
          platform: 'linkedin',
          connectedAt: '2026-09-12T08:00:00.000Z',
          lastImportedAt: '2026-09-12T08:00:00.000Z',
          receipt: { sourceMessageId: 'msg-li', memoryIds: ['a', 'b', 'gone'], factCount: 3 },
        },
      ],
      recorded: [
        {
          messageId: 'msg-hh',
          platform: 'hh',
          importedAt: '2026-10-07T08:00:00.000Z',
          factCount: 9,
        },
      ],
      messages: [],
      memory: [memory('a', ['msg-li']), memory('b', ['msg-li']), memory('h', ['msg-hh'])],
      walks: [walk],
    });
    expect(sources).toEqual([
      expect.objectContaining({ platform: 'linkedin', factCount: 3, keptFactCount: 2, walk }),
      expect.objectContaining({
        platform: 'hh',
        factCount: 9,
        keptFactCount: 1,
        lastImportedAt: '2026-10-07T08:00:00.000Z',
      }),
    ]);
  });

  it('falls back to the facts still present for a legacy label import', () => {
    const [source] = summarizeImportedSourcesWithKept({
      native: [],
      recorded: [],
      messages: [{ id: 'msg-legacy', content: 'Импорт: профиль LinkedIn' }],
      memory: [memory('a', ['msg-legacy']), memory('b', ['msg-legacy'])],
      walks: [],
    });
    expect(source).toMatchObject({ platform: 'linkedin', factCount: 2, keptFactCount: 2 });
  });
});
