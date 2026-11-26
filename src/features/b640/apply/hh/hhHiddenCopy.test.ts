import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HhResumeCopy, HhResumeEdit } from '../../../../../shared/hhCandidateSession';
import { createHiddenCopy, type HiddenCopyDeps, type HiddenCopyStep } from './hhHiddenCopy';

const item = (id: string, title = 'CTO') => ({ id, title, url: `https://hh.ru/resume/${id}` });
const PLACES = [{ employer: 'Ромашка', title: 'CTO', period: '2020', text: 'Вёл платформу' }];
const SKILLS: HhResumeEdit = { id: 's', section: 'skills', was: 'Go', now: 'Go, Kotlin', added: ['Kotlin'] };
const SOURCE = { id: 'src', title: 'CTO' };
const KNOWN = ['src', 'other'];

let log: string[];
let listed: ReturnType<typeof item>[];
let saved: (HhResumeCopy | null)[];
let deps: { -readonly [K in keyof HiddenCopyDeps]: ReturnType<typeof vi.fn> };

beforeEach(() => {
  log = [];
  saved = [];
  listed = [item('src'), item('other', 'COO')];
  const act = (name: string, result: object) => vi.fn(async (...args: unknown[]) => {
    log.push(`${name} ${String(typeof args[0] === 'string' ? args[0] : '')}`.trim());
    return result;
  });
  deps = {
    readList: vi.fn(async () => ({ kind: 'ready', resumes: listed })),
    readContent: vi.fn(async (entry: { id: string; title: string }) => ({
      id: entry.id, title: entry.title, text: 'x', sections: { title: entry.title, about: '', skills: [], places: PLACES },
    })),
    copy: vi.fn(async () => {
      log.push('copy');
      listed = [...listed, item('new')];
      return { outcome: 'copied', copyId: 'new' };
    }),
    hide: act('hide', { outcome: 'hidden' }),
    remove: vi.fn(async (id: string) => {
      log.push(`remove ${id}`);
      listed = listed.filter((entry) => entry.id !== id);
      return { outcome: 'deleted' };
    }),
    edit: vi.fn(async (input: { section: string; resumeId: string }) => {
      log.push(`edit ${input.section} ${input.resumeId}`);
      return { outcome: 'applied' };
    }),
    saveCopy: vi.fn(async (copy: HhResumeCopy | null) => {
      saved.push(copy);
      log.push(`save ${copy?.stage ?? 'none'}`);
    }),
    choose: vi.fn(async () => undefined),
    edits: vi.fn(async () => [SKILLS]),
    pause: vi.fn(async () => undefined),
  };
});

const steps: HiddenCopyStep[] = [];
const create = (started?: HhResumeCopy) =>
  createHiddenCopy(deps as unknown as HiddenCopyDeps, { source: SOURCE, vacancyTitle: 'Head of Platform', started }, (step) => steps.push(step));

describe('B787: скрытая копия резюме hh.ru', () => {
  it('скрывает копию до первой правки, сверяет видимость после должности и в конце', async () => {
    expect(await create()).toEqual({ ok: true, copyId: 'new' });
    expect(log).toEqual([
      'save creating', 'copy', 'save creating', 'hide new', 'save hidden',
      'edit title new', 'hide new', 'edit skills new', 'hide new', 'save ready',
    ]);
    expect(deps.copy).toHaveBeenCalledWith('src', KNOWN);
    expect(deps.choose).toHaveBeenCalledTimes(2);
  });

  it('правит только копию', async () => {
    await create();
    for (const [input] of deps.edit.mock.calls) expect((input as { resumeId: string }).resumeId).toBe('new');
  });

  it('не скрылась — копия удалена, ничего не заполнено', async () => {
    deps.hide.mockResolvedValue({ outcome: 'failed', failureCode: 'visibility_unconfirmed' });
    expect(await create()).toEqual({ ok: false, code: 'copy_removed' });
    expect(deps.hide).toHaveBeenCalledTimes(2);
    expect(deps.remove).toHaveBeenCalledWith('new', KNOWN);
    expect(deps.edit).not.toHaveBeenCalled();
    expect(deps.choose).not.toHaveBeenCalled();
    expect(saved.at(-1)).toBeNull();
  });

  it.each([['visibility_unconfirmed', 'copy_left_visible'], ['captcha', 'copy_left_captcha']])(
    'не скрылась (%s) и не удалилась — об этом сказано, повтор возьмёт ту же копию',
    async (code, shown) => {
      deps.hide.mockResolvedValue({ outcome: 'failed', failureCode: code });
      deps.remove.mockResolvedValue({ outcome: 'failed', failureCode: 'delete_unconfirmed' });
      expect(await create()).toEqual({ ok: false, code: shown });
      expect(saved.at(-1)).toMatchObject({ copyId: 'new', stage: 'creating' });
      deps.hide.mockResolvedValue({ outcome: 'hidden' });
      expect(await create(saved.at(-1)!)).toEqual({ ok: true, copyId: 'new' });
      expect(deps.copy).toHaveBeenCalledOnce();
    },
  );

  it('непрочитанный список не значит, что копия удалена', async () => {
    deps.hide.mockResolvedValue({ outcome: 'failed', failureCode: 'editor_missing' });
    deps.remove.mockImplementation(async () => {
      deps.readList.mockResolvedValue({ kind: 'empty' });
      return { outcome: 'deleted' };
    });
    expect(await create()).toEqual({ ok: false, code: 'copy_left_visible' });
  });

  it('запись на сервере не удалась — копия всё равно скрыта', async () => {
    deps.saveCopy.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    expect(await create()).toMatchObject({ ok: false });
    expect(deps.hide).toHaveBeenCalledOnce();
    expect(deps.edit).not.toHaveBeenCalled();
  });

  it('после должности hh.ru открыл копию всем и не скрыл — удаляем', async () => {
    deps.hide.mockResolvedValueOnce({ outcome: 'hidden' }).mockResolvedValue({ outcome: 'failed', failureCode: 'x' });
    expect(await create()).toEqual({ ok: false, code: 'copy_removed' });
    expect(deps.edit).toHaveBeenCalledOnce();
  });

  it('20 резюме — ошибка, hh.ru не трогаем', async () => {
    listed = Array.from({ length: 20 }, (_, index) => item(index === 0 ? 'src' : `r${index}`));
    expect(await create()).toEqual({ ok: false, code: 'limit_reached' });
    expect(deps.copy).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it('предел назвал сам hh.ru — начатое снято', async () => {
    deps.copy.mockResolvedValue({ outcome: 'failed', failureCode: 'limit_reached' });
    expect(await create()).toEqual({ ok: false, code: 'limit_reached' });
    expect(saved.at(-1)).toBeNull();
  });

  it('ответа hh.ru нет, а копия в списке — берём её, второй раз не нажимаем', async () => {
    deps.copy.mockImplementation(async () => {
      listed = [...listed, item('new')];
      throw new Error('session_window_missing');
    });
    expect(await create()).toEqual({ ok: true, copyId: 'new' });
    expect(deps.copy).toHaveBeenCalledOnce();
  });

  it('повтор после сбоя находит копию, появившуюся с начала', async () => {
    listed = [...listed, item('new')];
    expect(await create({ sourceId: 'src', knownIds: KNOWN, stage: 'creating' })).toEqual({ ok: true, copyId: 'new' });
    expect(deps.copy).not.toHaveBeenCalled();
  });

  it.each([[[item('new'), item('new2')]], [[item('mine', 'Моё новое резюме')]]])(
    'непонятно, какое резюме копия, — останавливаемся и чужое не трогаем',
    async (extra) => {
      listed = [...listed, ...extra];
      expect(await create({ sourceId: 'src', knownIds: KNOWN, stage: 'creating' })).toEqual({ ok: false, code: 'copy_ambiguous' });
      expect(deps.copy).not.toHaveBeenCalled();
      expect(deps.hide).not.toHaveBeenCalled();
      expect(deps.remove).not.toHaveBeenCalled();
    },
  );

  it('отказ правки останавливает заполнение, копия скрыта и остаётся для повтора', async () => {
    deps.edit.mockResolvedValue({ outcome: 'failed', failureCode: 'field_locked' });
    expect(await create()).toEqual({ ok: false, code: 'field_locked' });
    expect(saved.at(-1)).toMatchObject({ copyId: 'new', stage: 'hidden' });
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it('B787: «не вошёл» после нажатия — копия найдена в списке, вторая не создаётся', async () => {
    let calls = 0;
    deps.readList.mockImplementation(async () => {
      calls += 1;
      return { kind: 'ready', resumes: calls === 1 ? listed : [...listed, item('new')] };
    });
    deps.copy.mockResolvedValue({ outcome: 'failed', failureCode: 'not_signed_in' });
    await create();
    expect(deps.copy).toHaveBeenCalledTimes(1);
    expect(deps.hide.mock.calls[0]?.[0]).toBe('new');
  });

  it('B787: сбой копии и непрочитанный список — начатое не забывается', async () => {
    let calls = 0;
    deps.readList.mockImplementation(async () => {
      calls += 1;
      if (calls > 1) throw new Error('hh_resumes_not_read');
      return { kind: 'ready', resumes: listed };
    });
    deps.copy.mockResolvedValue({ outcome: 'failed', failureCode: 'menu_missing' });
    expect(await create()).toEqual({ ok: false, code: 'menu_missing' });
    expect(saved).not.toContainEqual(null);
    expect(saved.at(-1)).toMatchObject({ sourceId: 'src', stage: 'creating' });
  });

  it('нет входа — ничего не начато', async () => {
    deps.readList.mockResolvedValue({ kind: 'signed_out' });
    expect(await create()).toEqual({ ok: false, code: 'not_signed_in' });
    expect(saved).toEqual([]);
  });
});
