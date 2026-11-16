import { describe, expect, it } from 'vitest';
import { CANDIDATE_STATUSES, TODAY_STATUS_MODULE_KEYS } from '../../shared/candidateStatus';
import {
  buildStatusPreview,
  normalizeTargetProfession,
  revertDeadline,
  shouldPauseAutoApply,
  todayModulesFor,
} from './candidateStatus';

const idle = { autoApplyPaused: false };

describe('buildStatusPreview', () => {
  it('describes what appears, leaves and stays for every pair of statuses', () => {
    for (const from of CANDIDATE_STATUSES) {
      for (const to of CANDIDATE_STATUSES) {
        if (from === to) continue;
        const preview = buildStatusPreview({ status: from, targetProfession: null }, { status: to, targetProfession: null }, idle);
        expect(preview.unchanged).toBe(false);
        expect(preview.appears.length).toBeGreaterThan(0);
        expect(preview.leaves.length).toBeGreaterThan(0);
        expect(preview.stays.length).toBeGreaterThan(0);
      }
    }
  });

  it('names the new profession in the title and in what appears', () => {
    const preview = buildStatusPreview(
      { status: 'job_search', targetProfession: null },
      { status: 'changing_profession', targetProfession: 'продакт-менеджер' },
      idle,
    );
    expect(preview.title).toBe('Меняю профессию: продакт-менеджер');
    expect(preview.appears).toContain('Что подходит и чего не хватает — на «Сегодня»');
    expect(preview.appears.join(' ')).toContain('продакт-менеджер');
  });

  it('pre-checks the auto-apply pause only when moving to «Работаю»', () => {
    const toWorking = buildStatusPreview({ status: 'job_search', targetProfession: null }, { status: 'working', targetProfession: null }, idle);
    expect(toWorking.options).toEqual([
      { key: 'pauseAutoApply', label: 'Поставить автоотклики на паузу', checked: true },
    ]);
    const toLooking = buildStatusPreview({ status: 'job_search', targetProfession: null }, { status: 'looking', targetProfession: null }, idle);
    expect(toLooking.options[0]?.checked).toBe(false);
  });

  it('hides the pause option when auto-applies are already paused', () => {
    const preview = buildStatusPreview(
      { status: 'job_search', targetProfession: null },
      { status: 'working', targetProfession: null },
      { autoApplyPaused: true },
    );
    expect(preview.options).toEqual([]);
  });

  it('marks the same status with the same profession as unchanged', () => {
    const same = buildStatusPreview({ status: 'working', targetProfession: null }, { status: 'working', targetProfession: null }, idle);
    expect(same.unchanged).toBe(true);
    expect(same.appears).toEqual([]);
    expect(same.leaves).toEqual([]);
    const otherProfession = buildStatusPreview(
      { status: 'changing_profession', targetProfession: 'аналитик' },
      { status: 'changing_profession', targetProfession: 'продакт-менеджер' },
      idle,
    );
    expect(otherProfession.unchanged).toBe(false);
  });

  it('keeps candidate-facing texts free of internal words', () => {
    const texts = CANDIDATE_STATUSES.flatMap((from) =>
      CANDIDATE_STATUSES.flatMap((to) => {
        const preview = buildStatusPreview({ status: from, targetProfession: null }, { status: to, targetProfession: null }, idle);
        return [...preview.appears, ...preview.leaves, ...preview.stays, ...preview.options.map((option) => option.label)];
      }),
    );
    for (const text of texts) {
      expect(text).not.toMatch(/недоступн|маршрут|модул|R[1-4]|API|LLM|модель/i);
    }
  });
});

describe('shouldPauseAutoApply', () => {
  it('pauses for «Работаю» unless the candidate cleared the mark', () => {
    expect(shouldPauseAutoApply('working', {})).toBe(true);
    expect(shouldPauseAutoApply('working', { pauseAutoApply: true })).toBe(true);
    expect(shouldPauseAutoApply('working', { pauseAutoApply: false })).toBe(false);
  });

  it('pauses for other statuses only when the candidate set the mark', () => {
    expect(shouldPauseAutoApply('looking', {})).toBe(false);
    expect(shouldPauseAutoApply('looking', { pauseAutoApply: true })).toBe(true);
  });
});

describe('todayModulesFor', () => {
  it('returns a distinct known set with a different lead module per status', () => {
    const leads = CANDIDATE_STATUSES.map((status) => {
      const modules = todayModulesFor(status);
      expect(modules.length).toBeGreaterThan(0);
      for (const module of modules) expect(TODAY_STATUS_MODULE_KEYS).toContain(module.key);
      expect(new Set(modules.map((module) => module.key)).size).toBe(modules.length);
      return modules[0]?.key;
    });
    expect(new Set(leads).size).toBe(CANDIDATE_STATUSES.length);
  });

  it('leads «Работаю» with the plan and «Меняю профессию» with the fit', () => {
    expect(todayModulesFor('working').map((module) => module.key)).toEqual(['onboarding_plan', 'next_meeting', 'record_result']);
    expect(todayModulesFor('changing_profession')[0]?.key).toBe('profession_fit');
  });
});

describe('revertDeadline', () => {
  it('ends at the next local midnight of the account timezone', () => {
    // 16.11 20:30 UTC = 16.11 23:30 в Москве → до 21:00 UTC.
    expect(revertDeadline(new Date('2026-11-16T20:30:00.000Z'), 'Europe/Moscow')).toBe('2026-11-16T21:00:00.000Z');
    // 16.11 21:30 UTC = 17.11 00:30 в Москве → до 21:00 UTC следующего дня.
    expect(revertDeadline(new Date('2026-11-16T21:30:00.000Z'), 'Europe/Moscow')).toBe('2026-11-17T21:00:00.000Z');
    expect(revertDeadline(new Date('2026-11-16T20:30:00.000Z'), 'Asia/Vladivostok')).toBe('2026-11-17T14:00:00.000Z');
  });
});

describe('normalizeTargetProfession', () => {
  it('keeps the profession only for «Меняю профессию», trimmed and single-spaced', () => {
    expect(normalizeTargetProfession('changing_profession', '  продакт-\n менеджер ')).toBe('продакт- менеджер');
    expect(normalizeTargetProfession('changing_profession', '   ')).toBeNull();
    expect(normalizeTargetProfession('working', 'продакт-менеджер')).toBeNull();
    expect(normalizeTargetProfession('changing_profession', undefined)).toBeNull();
  });
});
