// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactRewriteProposal } from '../../../server/domain/experienceFactRewrite';
import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';
import { CoachApiError } from '../coach/apiClient';
import type { CandidateMemory } from '../coach/coachApi';
import * as api from './experienceFactRewriteApi';
import { ExperienceSuggestionsList } from './ProfileExperienceSection';
import type { ResumeDraft } from './resumeTypes';

const draft: ResumeDraft = {
  ...EMPTY_RESUME_DRAFT,
  experience: [
    {
      id: 'rosseti',
      chronologyMemoryId: 'rosseti-chronology',
      employer: 'Россети Цифра',
      startDate: 'Apr 2023',
      endDate: 'Oct 2025',
      current: false,
      bulletMemoryIds: ['imported-1'],
    },
    {
      id: 'fishance',
      chronologyMemoryId: 'fishance-chronology',
      employer: 'Fishance Berhad',
      startDate: 'Jul 2016',
      endDate: 'Oct 2019',
      current: false,
      bulletMemoryIds: [],
    },
  ],
};

function fact(id: string, statement: string): CandidateMemory {
  return {
    id,
    kind: 'fact',
    domain: 'outcome',
    statement,
    confidence: 'candidate-reported',
    sourceMessageIds: [`msg-${id}`],
    sensitive: false,
    status: 'confirmed',
    provenance: { kind: 'candidate', at: '2026-10-25T10:00:00.000Z' },
  };
}

const memory = [
  fact('f-rosseti', 'В Россети Цифра выручка выросла вчетверо.'),
  fact('f-fishance', 'Fishance продана с выручкой $50M+.'),
  fact('f-loose', 'Тикетов стало на 40% меньше.'),
];

const proposal: FactRewriteProposal = {
  id: 'proposal-1',
  places: [
    {
      experienceId: 'rosseti',
      bullets: [{ text: 'Увеличил выручку направления в 4 раза.', sourceFactIds: ['f-rosseti'] }],
    },
    {
      experienceId: 'fishance',
      bullets: [
        {
          text: 'Вывел компанию на выручку $50M+ и довёл до продажи.',
          sourceFactIds: ['f-fishance'],
        },
      ],
    },
  ],
  leftOutFactIds: ['f-loose'],
  sourceFactIds: ['f-rosseti', 'f-fishance', 'f-loose'],
};

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(api, 'requestFactRewrite').mockResolvedValue(proposal);
});

async function mount(node: ReactNode): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  disposers.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

function render(
  options: {
    readonly draft?: ResumeDraft;
    readonly onSectionSave?: (next: ResumeDraft) => boolean;
    readonly onRefresh?: () => void;
  } = {},
) {
  return mount(
    <ExperienceSuggestionsList
      draft={options.draft ?? draft}
      memory={memory}
      suggestions={[]}
      onSectionSave={options.onSectionSave ?? vi.fn(() => true)}
      onManualExperienceFactAdded={options.onRefresh}
    />,
  );
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(label),
  );
  if (!found) throw new Error(`no button «${label}»`);
  return found;
}

describe('consultant rewrite of conversation facts in «Опыт» (29.10)', () => {
  it('shows the consultant’s bullets by employer and never the candidate’s raw words', async () => {
    const container = await render();
    const block = container.querySelector('[data-testid="experience-fact-rewrite"]')!;
    expect(block.textContent).toContain('Консультант переписал рассказанное вами в пункты «Опыта»');
    const places = [...block.querySelectorAll('[data-experience-id]')];
    expect(places.map((place) => place.getAttribute('data-experience-id'))).toEqual([
      'rosseti',
      'fishance',
    ]);
    expect(places[0]!.textContent).toContain('Россети Цифра');
    expect(places[0]!.textContent).toContain('Увеличил выручку направления в 4 раза.');
    for (const item of memory) expect(container.textContent).not.toContain(item.statement);
    expect(block.textContent).toContain('1 факт из беседы консультант не взял');
    expect(container.querySelector('select')).toBeNull();
    expect(api.requestFactRewrite).toHaveBeenCalledTimes(1);
  });

  it('applies everything with one «Принять» and re-reads the profile', async () => {
    const apply = vi.spyOn(api, 'applyFactRewrite').mockResolvedValue({
      id: 'proposal-1',
      appliedAt: '2026-10-29T12:00:00.000Z',
      bullets: [],
      declinedFactIds: ['f-loose'],
    });
    const onRefresh = vi.fn();
    const onSectionSave = vi.fn(() => true);
    const container = await render({ onRefresh, onSectionSave });
    await act(async () => button(container, 'Принять').click());
    expect(apply).toHaveBeenCalledWith('proposal-1', {});
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onSectionSave).not.toHaveBeenCalled();
  });

  it('lets the candidate edit or remove a bullet before «Принять» and sends that set', async () => {
    const apply = vi.spyOn(api, 'applyFactRewrite').mockResolvedValue({
      id: 'proposal-1',
      appliedAt: '2026-10-29T12:00:00.000Z',
      bullets: [],
      declinedFactIds: [],
    });
    const container = await render();
    const rosseti = container.querySelector('[data-experience-id="rosseti"]') as HTMLElement;
    await act(async () => button(rosseti, 'Изменить').click());
    const field = rosseti.querySelector('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(field, 'Вырастил выручку направления в 4 раза.');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button(rosseti, 'Готово').click());
    expect(rosseti.textContent).toContain('Вырастил выручку направления в 4 раза.');
    const fishance = container.querySelector('[data-experience-id="fishance"]') as HTMLElement;
    await act(async () => button(fishance, 'Убрать').click());
    expect(container.querySelector('[data-experience-id="fishance"]')).toBeNull();
    await act(async () => button(container, 'Принять').click());
    expect(apply).toHaveBeenCalledWith('proposal-1', {
      'rosseti#0': 'Вырастил выручку направления в 4 раза.',
      'fishance#0': null,
    });
  });

  it('declines every source fact with «Отклонить», leaving memory as it is', async () => {
    const onSectionSave = vi.fn((_next: ResumeDraft) => true);
    const container = await render({ onSectionSave });
    await act(async () => button(container, 'Отклонить').click());
    expect(onSectionSave.mock.calls[0]![0].declinedFactIds).toEqual([
      'f-rosseti',
      'f-fishance',
      'f-loose',
    ]);
    expect(onSectionSave.mock.calls[0]![0].experience).toEqual(draft.experience);
  });

  it('asks the consultant again when the proposal went stale', async () => {
    vi.spyOn(api, 'applyFactRewrite').mockRejectedValue(
      new CoachApiError('Факты или места работы изменились.', 'rewrite_stale', true),
    );
    const container = await render();
    await act(async () => button(container, 'Принять').click());
    expect(api.requestFactRewrite).toHaveBeenCalledTimes(2);
  });

  it('offers «Отменить правку» for a fresh rewrite and undoes it', async () => {
    vi.spyOn(api, 'requestFactRewrite').mockResolvedValue(null);
    const revert = vi.spyOn(api, 'revertFactRewrite').mockResolvedValue();
    const onRefresh = vi.fn();
    const applied: ResumeDraft = {
      ...draft,
      declinedFactIds: ['f-rosseti', 'f-fishance', 'f-loose'],
      factRewrites: [
        {
          id: 'rewrite-1',
          appliedAt: new Date().toISOString(),
          bullets: [],
          declinedFactIds: ['f-loose'],
        },
      ],
    };
    const container = await render({ draft: applied, onRefresh });
    expect(api.requestFactRewrite).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Пункты консультанта добавлены в «Опыт».');
    await act(async () => button(container, 'Отменить правку').click());
    expect(revert).toHaveBeenCalledWith('rewrite-1');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('says the consultant failed and retries on request', async () => {
    const request = vi
      .spyOn(api, 'requestFactRewrite')
      .mockRejectedValueOnce(new Error('Консультант не успел подготовить формулировки.'))
      .mockResolvedValueOnce(proposal);
    const container = await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('не успел');
    await act(async () => button(container, 'Повторить').click());
    expect(request).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Увеличил выручку направления в 4 раза.');
  });

  it('shows no block for a proposal without bullets, so nothing can be declined blindly', async () => {
    vi.spyOn(api, 'requestFactRewrite').mockResolvedValue({
      ...proposal,
      places: [],
      leftOutFactIds: proposal.sourceFactIds,
    });
    const container = await render();
    expect(container.querySelector('[data-testid="experience-fact-rewrite"]')).toBeNull();
  });

  it('shows nothing when every conversation fact is already handled', async () => {
    const container = await render({
      draft: { ...draft, declinedFactIds: ['f-rosseti', 'f-fishance', 'f-loose'] },
    });
    expect(container.querySelector('[data-testid="experience-fact-rewrite"]')).toBeNull();
    expect(api.requestFactRewrite).not.toHaveBeenCalled();
  });
});
