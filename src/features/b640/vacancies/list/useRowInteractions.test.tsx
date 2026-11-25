// @vitest-environment jsdom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listApplications, type ApplicationView } from '../../../applications/applicationsApi';
import { click, mount } from '../../kit/testDom';
import { hideVacancy, unhideVacancy } from '../skipApi';
import { isSaved, useVacancyLinks } from '../vacancyLinks';
import { makeItem } from './fixtures';
import { useRowInteractions } from './useRowInteractions';

const show = vi.fn();
vi.mock('../../kit', () => ({ useToast: () => ({ show }) }));
vi.mock('../../shell/ShellContext', () => ({ useShell: () => ({ navigate: vi.fn() }) }));
vi.mock('../skipApi', () => ({ hideVacancy: vi.fn(), unhideVacancy: vi.fn() }));
vi.mock('../../../vacancies/candidateCompaniesApi', () => ({ listCandidateCompanyWants: async () => [] }));
vi.mock('../../../applications/applicationsApi', () => ({ listApplications: vi.fn() }));

const item = makeItem({ id: 'c1' });
let server: ApplicationView;

beforeEach(() => {
  server = { id: 'a1', clusterId: 'c1', stage: 'saved', starred: true, version: 1 } as ApplicationView;
  vi.mocked(listApplications).mockImplementation(async () => [server]);
  vi.mocked(hideVacancy).mockImplementation(async () => {
    server = { ...server, stage: 'archived', version: 2 };
  });
  vi.mocked(unhideVacancy).mockImplementation(async () => {
    server = { ...server, stage: 'saved', version: 3 };
  });
});

function Probe() {
  const links = useVacancyLinks();
  const rows = useRowInteractions(links);
  const application = links.byCluster.get('c1');
  return (
    <div>
      <button id="hide" onClick={() => void rows.actionsFor(item).hide('company')} />
      <output>{`${isSaved(application)} v${application?.version} hidden=${rows.hiddenIds.has('c1')}`}</output>
    </div>
  );
}

describe('скрытие сохранённой вакансии и отмена (B654)', () => {
  it('звезда и версия карточки — как на сервере после «Скрыть» и «Отменить»', async () => {
    const view = mount(<Probe />);
    const flush = () => act(async () => {});
    const text = () => view.container.querySelector('output')!.textContent;
    await flush();
    expect(text()).toBe('true v1 hidden=false');
    click(view.container.querySelector('#hide')!);
    await flush();
    await flush();
    expect(text()).toBe('false v2 hidden=true');
    act(() => show.mock.calls[0]![0].undo.onUndo());
    await flush();
    await flush();
    expect(text()).toBe('true v3 hidden=false');
    view.unmount();
  });
});
