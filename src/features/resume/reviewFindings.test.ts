import { describe, expect, it } from 'vitest';
import type { CandidateMemory } from '../coach/coachApi';
import {
  aboutFinding,
  experienceFinding,
  experienceFindingCount,
  teamSizeFinding,
} from './reviewFindings';

const memory = (id: string, statement: string) => ({ id, statement }) as CandidateMemory;
const role = (id: string, bulletMemoryIds: string[]) => ({ id, bulletMemoryIds });

describe('review findings', () => {
  it('counts the roles whose bullets carry a figure', () => {
    const items = [
      memory('a', 'Сократил время релиза с 14 до 3 дней'),
      memory('b', 'Строил команду'),
    ];
    const draft = { experience: [role('r1', ['a']), role('r2', ['b']), role('r3', [])] };
    expect(experienceFinding(draft as never, items)).toBe(
      'Результаты в цифрах: в 1 из 3 мест. Размер команды неизвестен в 3 местах.',
    );
  });

  it('names the roles without a team size (B540)', () => {
    const draft = {
      experience: [{ ...role('r1', []), teamSize: 38 }, role('r2', []), role('r3', [])],
    };
    expect(teamSizeFinding(draft as never)).toBe('Размер команды неизвестен в 2 местах.');
    expect(teamSizeFinding({ experience: [role('r1', [])] } as never)).toBe(
      'Размер команды неизвестен в 1 месте.',
    );
    expect(teamSizeFinding({ experience: [{ ...role('r1', []), teamSize: 5 }] } as never)).toBe(
      undefined,
    );
  });

  it('joins the figures and team size findings and counts the team size one', () => {
    const items = [memory('a', 'Сократил время релиза с 14 до 3 дней')];
    const draft = {
      experience: [role('r1', ['a']), { ...role('r2', []), teamSize: 9 }, role('r3', [])],
    };
    expect(experienceFinding(draft as never, items)).toBe(
      'Результаты в цифрах: в 1 из 3 мест. Размер команды неизвестен в 2 местах.',
    );
    expect(experienceFindingCount(draft as never)).toBe(1);
    expect(
      experienceFindingCount({ experience: [{ ...role('r1', []), teamSize: 9 }] } as never),
    ).toBe(0);
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
