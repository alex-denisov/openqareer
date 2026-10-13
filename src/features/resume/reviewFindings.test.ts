import { describe, expect, it } from 'vitest';
import type { CandidateMemory } from '../coach/coachApi';
import { aboutFinding, experienceFinding } from './reviewFindings';

const memory = (id: string, statement: string) => ({ id, statement }) as CandidateMemory;
const role = (id: string, bulletMemoryIds: string[]) => ({ id, bulletMemoryIds });

describe('review findings', () => {
  it('counts the roles whose bullets carry a figure', () => {
    const items = [
      memory('a', 'Сократил время релиза с 14 до 3 дней'),
      memory('b', 'Строил команду'),
    ];
    const draft = { experience: [role('r1', ['a']), role('r2', ['b']), role('r3', [])] };
    expect(experienceFinding(draft as never, items)).toBe('Результаты в цифрах: в 1 из 3 мест.');
  });

  it('says nothing for an empty experience block', () => {
    expect(experienceFinding({ experience: [] } as never, [])).toBeUndefined();
  });

  it('describes the about paragraph by paragraphs and sentences', () => {
    expect(aboutFinding('Первое. Второе. Третье.')).toBe('Один абзац, предложений: 3.');
    expect(aboutFinding('А.\n\nБ.')).toBe('Абзацев: 2, предложений: 2.');
    expect(aboutFinding('  ')).toBeUndefined();
  });
});
