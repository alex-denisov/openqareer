// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as preview from './vacancyLetterResumePreview';
import { VacancyLetterResumePanel } from './VacancyLetterResumePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function mount(element: React.ReactElement) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(element);
  });
  return host;
}

describe('VacancyLetterResumePanel (B631)', () => {
  it('shows the resume for this vacancy over the letter and closes back to it', async () => {
    vi.spyOn(preview, 'loadLetterResumePreview').mockResolvedValue({
      kind: 'targeted',
      title: 'Резюме под вакансию',
      text: 'ИВАН ИВАНОВ\nHead of Platform',
    });
    const onClose = vi.fn();
    const node = await mount(
      <VacancyLetterResumePanel vacancyId="v1" approved={null} onClose={onClose} />,
    );
    const dialog = node.querySelector('dialog');
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(node.textContent).toContain('Резюме под вакансию');
    expect(node.textContent).toContain('ИВАН ИВАНОВ');
    const close = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Вернуться к письму');
    act(() => close?.click());
    expect(onClose).toHaveBeenCalled();
  });

  it('says what went wrong and lets the candidate retry', async () => {
    const load = vi
      .spyOn(preview, 'loadLetterResumePreview')
      .mockRejectedValueOnce(new Error('Не удалось подготовить резюме.'))
      .mockResolvedValue({ kind: 'master', title: 'Резюме', text: 'общее' });
    const node = await mount(
      <VacancyLetterResumePanel vacancyId="v1" approved={null} onClose={vi.fn()} />,
    );
    expect(node.querySelector('[role="alert"]')?.textContent).toContain('Не удалось подготовить резюме.');
    const retry = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Повторить');
    await act(async () => retry?.click());
    expect(load).toHaveBeenCalledTimes(2);
    expect(node.textContent).toContain('общее');
  });

  it('without experience points to the profile, where it can be added', async () => {
    vi.spyOn(preview, 'loadLetterResumePreview').mockResolvedValue({
      kind: 'none',
      title: 'Резюме',
      text: '',
    });
    const onOpenProfile = vi.fn();
    const node = await mount(
      <VacancyLetterResumePanel
        vacancyId="v1"
        approved={null}
        onClose={vi.fn()}
        onOpenProfile={onOpenProfile}
      />,
    );
    expect(node.textContent).toContain('В профиле нет опыта работы');
    const open = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Открыть «Профиль»');
    act(() => open?.click());
    expect(onOpenProfile).toHaveBeenCalled();
  });
});
