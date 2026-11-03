// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VacancyLetterMobileBar } from './VacancyLetterMobileBar';

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.replaceChildren();
});

async function mount(props: Parameters<typeof VacancyLetterMobileBar>[0]) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<VacancyLetterMobileBar {...props} />));
  return host;
}

describe('VacancyLetterMobileBar (mockup 9 at 390)', () => {
  it('shows back, the «Письмо» title and the consultant entry', async () => {
    const onBack = vi.fn();
    const onOpenConsultant = vi.fn();
    const host = await mount({ onBack, onOpenConsultant });
    expect(host.querySelector('h1')?.textContent).toBe('Письмо');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Консультант: открыть"]')?.click(),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Назад к вакансиям"]')?.click(),
    );
    expect(onOpenConsultant).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('omits the consultant button when the screen has no consultant', async () => {
    const host = await mount({ onBack: () => undefined });
    expect(host.querySelector('[aria-label="Консультант: открыть"]')).toBeNull();
  });
});
