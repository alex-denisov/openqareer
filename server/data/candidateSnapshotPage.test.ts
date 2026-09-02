import { describe, expect, it } from 'vitest';
import { SNAPSHOT_PAGE_BYTE_BUDGET, buildSnapshotHead } from './candidateSnapshotPage';

/**
 * Снимок кандидата весил 59 561 байт, а маршрут доносит около 20 460 (INC-030):
 * «Главная» и факты кандидата оставались пустыми при полной базе. Первый ответ обязан
 * помещаться в бюджет и честно говорить, сколько осталось.
 */
function snapshot(memoryCount: number, messageCount: number, turnCount: number) {
  return {
    candidate: { id: 'candidate-1' },
    dossier: {
      confirmedCount: 12,
      proposedCount: 3,
      sections: Array.from({ length: 5 }, (_, index) => ({
        domain: `domain-${index}`,
        items: Array.from({ length: 20 }, (_, item) => ({ id: `item-${index}-${item}` })),
      })),
    },
    memory: Array.from({ length: memoryCount }, (_, index) => ({
      id: `memory-${index}`,
      statement: `Факт кандидата номер ${index}. `.repeat(4),
      kind: 'fact',
    })),
    messages: Array.from({ length: messageCount }, (_, index) => ({
      id: `message-${index}`,
      content: 'Реплика диалога. '.repeat(30),
    })),
    turns: Array.from({ length: turnCount }, (_, index) => ({
      id: `turn-${index}`,
      createdAt: new Date(Date.UTC(2026, 7, 1 + index)).toISOString(),
      payload: 'x'.repeat(400),
    })),
  };
}

describe('buildSnapshotHead', () => {
  it('укладывает первый ответ в бюджет маршрута', () => {
    const { data } = buildSnapshotHead(snapshot(400, 200, 40), 0);
    expect(Buffer.byteLength(JSON.stringify(data), 'utf8')).toBeLessThanOrEqual(
      SNAPSHOT_PAGE_BYTE_BUDGET,
    );
  });

  it('оставляет у набора фактов счёт, но не его разделы', () => {
    const { data } = buildSnapshotHead(snapshot(10, 0, 0), 0);
    expect(data.dossier.confirmedCount).toBe(12);
    expect(data.dossier.sections).toEqual([]);
  });

  it('не тащит диалог в первый ответ и говорит, сколько его', () => {
    const { data, meta } = buildSnapshotHead(snapshot(10, 200, 5), 0);
    expect(data.messages).toEqual([]);
    expect(meta.messages.total).toBe(200);
  });

  it('оставляет последние ходы, а не первые, и только те, что влезли', () => {
    const { data, meta } = buildSnapshotHead(snapshot(10, 0, 40), 0);
    expect(data.turns.length).toBeLessThan(40);
    expect(data.turns.at(-1)?.id).toBe('turn-39');
    expect(meta.turns.total).toBe(40);
  });

  it('не тащит ход, который сам не помещается, и говорит об этом', () => {
    const heavy = snapshot(0, 0, 5);
    heavy.turns = heavy.turns.map((turn) => ({ ...turn, payload: 'x'.repeat(20_000) }));
    const { data, meta } = buildSnapshotHead(heavy, 0);
    expect(data.turns).toEqual([]);
    expect(meta.turns.total).toBe(5);
    // Ход не влез — экран дочитает его отдельной страницей, а не решит, что
    // ходов не было.
    expect(meta.turns.nextOffset).toBe(0);
    expect(Buffer.byteLength(JSON.stringify(data), 'utf8')).toBeLessThanOrEqual(
      SNAPSHOT_PAGE_BYTE_BUDGET,
    );
  });

  it('называет свой размер, чтобы бюджет можно было проверить снаружи', () => {
    const { data, meta } = buildSnapshotHead(snapshot(50, 20, 4), 0);
    expect(meta.headBytes).toBe(Buffer.byteLength(JSON.stringify(data), 'utf8'));
  });

  it('отдаёт память страницами и показывает, где продолжить', () => {
    const first = buildSnapshotHead(snapshot(400, 0, 0), 0);
    expect(first.meta.memory.total).toBe(400);
    expect(first.meta.memory.nextOffset).toBe(first.data.memory.length);
    expect(first.data.memory[0].id).toBe('memory-0');

    const second = buildSnapshotHead(snapshot(400, 0, 0), first.meta.memory.nextOffset ?? 0);
    expect(second.data.memory[0].id).toBe(`memory-${first.data.memory.length}`);
  });

  it('короткий снимок доходит целиком и не обещает продолжения', () => {
    const { data, meta } = buildSnapshotHead(snapshot(3, 0, 2), 0);
    expect(data.memory).toHaveLength(3);
    expect(meta.memory.nextOffset).toBeNull();
  });
});
