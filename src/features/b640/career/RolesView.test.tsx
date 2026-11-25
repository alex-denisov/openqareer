// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignMetaView } from '../../coach/matchedVacancyApi';
import { clearSectionCache } from '../../shell/sectionCache';
import { mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import * as api from './careerApi';
import { RolesView } from './RolesScreen';

vi.mock('../shell/ShellContext', () => ({
  useShell: () => ({ search: '', navigate: () => undefined }),
}));
vi.mock('./careerApi', () => ({
  loadCampaign: vi.fn(),
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
});
