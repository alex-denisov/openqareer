// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignMetaView } from '../../coach/matchedVacancyApi';
import { clearSectionCache } from '../../shell/sectionCache';
import { mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import * as api from './careerApi';
import { RolesView } from './RolesScreen';

const shell = vi.hoisted(() => ({ search: '' }));
vi.mock('../shell/ShellContext', () => ({
  useShell: () => ({ search: shell.search, navigate: () => undefined }),
}));
vi.mock('./careerApi', () => ({
  loadCampaign: vi.fn(),
  loadFreshCampaign: vi.fn(),
  saveSearchRoles: vi.fn(),
  loadRoles: vi.fn(),
  loadSelectionTotal: vi.fn().mockResolvedValue(null),
  loadSkillStrip: vi.fn().mockResolvedValue(null),
}));

const campaign = {
  roles: { value: ['Архитектор'], origin: 'user' },
} as unknown as CampaignMetaView;
let view: Mounted | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  shell.search = '';
  vi.mocked(api.loadSelectionTotal).mockResolvedValue(null);
  vi.mocked(api.loadSkillStrip).mockResolvedValue(null);
});
afterEach(() => {
  view?.unmount();
  clearSectionCache();
});

const render = async () => {
  view = mount(<RolesView node={nodeByCode('s09')!} />);
  await act(async () => undefined);
  return view.container;
};

describe('B792: «Карьера» частями', () => {
  it('роль поиска видна, пока роли ещё считаются; число и навыки ждут таблицу', async () => {
    let done!: (data: api.RolesData) => void;
    vi.mocked(api.loadCampaign).mockResolvedValue(campaign);
    vi.mocked(api.loadRoles).mockReturnValue(new Promise((resolve) => (done = resolve)));
    const page = await render();
    expect(page.textContent).toContain('Архитектор');
    expect(page.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(api.loadSkillStrip).not.toHaveBeenCalled();
    expect(api.loadSelectionTotal).not.toHaveBeenCalledWith(['Архитектор'], expect.anything());
    await act(async () => done({ rows: [], searchTitles: ['Архитектор'], campaign }));
    expect(page.querySelector('[aria-busy="true"]')).toBeNull();
    expect(api.loadSkillStrip).toHaveBeenCalled();
    expect(api.loadSelectionTotal).toHaveBeenLastCalledWith(['Архитектор'], expect.anything());
  });

  it('сбой ролей — ошибка на месте таблицы, роль поиска остаётся', async () => {
    vi.mocked(api.loadCampaign).mockResolvedValue(campaign);
    vi.mocked(api.loadRoles).mockRejectedValue(new Error('сбой'));
    const page = await render();
    expect(page.textContent).toContain('Архитектор');
    expect(page.textContent).toContain('Не удалось загрузить роли.');
  });

  it('место полосы навыков держится с первого кадра до её чтения', async () => {
    let done!: (value: null) => void;
    vi.mocked(api.loadCampaign).mockResolvedValue(campaign);
    vi.mocked(api.loadRoles).mockResolvedValue({ rows: [], searchTitles: [], campaign });
    vi.mocked(api.loadSkillStrip).mockReturnValue(new Promise((resolve) => (done = resolve)));
    const page = await render();
    expect(page.querySelector('.sk-place')).not.toBeNull();
    await act(async () => done(null));
    expect(page.querySelector('.sk-place')).toBeNull();
  });

  it('выбор ролей отмечает роли свежей кампании, а не показанной', async () => {
    shell.search = '?pick=1';
    const row = (title: string) =>
      ({ id: title, title, label: title, origin: 'search', wage: null, vacancies: 1 }) as never;
    const rows = [row('Архитектор'), row('CTO')];
    vi.mocked(api.loadCampaign).mockResolvedValue(campaign);
    vi.mocked(api.loadRoles).mockResolvedValue({ rows, searchTitles: ['Архитектор'], campaign });
    vi.mocked(api.loadFreshCampaign).mockResolvedValue({
      roles: { value: ['CTO'], origin: 'user' },
    } as unknown as CampaignMetaView);
    await render();
    const boxes = [...document.querySelectorAll<HTMLInputElement>('.rs-set input')];
    expect(boxes.map((box) => box.checked)).toEqual([false, true]);
  });
});
