// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../coach/coachApi';
import { DIARY_TITLE_TIP, useDiaryTitleTip } from '../diary/diaryTitleTip';
import { click, mount, press, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { ShellProvider, useShell } from './ShellContext';
import { Topbar } from './Topbar';

const session = {
  username: 'f.test',
  role: 'candidate',
  isTest: true,
  candidateId: 'c',
  features: { cabinetB640: true },
  emailVerified: true,
} as AuthUser;
const shell = {
  session,
  path: '/app/diary',
  search: '',
  match: null,
  consultantRoute: null,
  navigate: vi.fn(),
  signOut: async () => undefined,
  theme: 'light' as const,
  setTheme: () => undefined,
};
const bar = { active: null, bellCount: 0, bellCritical: false, coachDot: false, back: null };

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

function render(element: React.ReactElement): HTMLElement {
  view = mount(<ShellProvider value={shell}>{element}</ShellProvider>);
  return view.container;
}

describe('Topbar: ⓘ у заголовка (B645-2, п. 97)', () => {
  it('без titleTip заголовок прежний: только текст, без ⓘ', () => {
    const root = render(<Topbar title="Сегодня" {...bar} />);
    expect(root.querySelector('h1')?.outerHTML).toBe('<h1>Сегодня</h1>');
    expect(root.querySelector('.top-tip')).toBeNull();
  });

  it('с titleTip — ⓘ «Кто видит» в заголовке, текст в подсказке; Enter закрепляет, Esc снимает', () => {
    const root = render(<Topbar title="Дневник" titleTip={DIARY_TITLE_TIP} {...bar} />);
    const button = root.querySelector<HTMLButtonElement>('h1 .top-tip button.icon-btn.info');
    expect(button?.getAttribute('aria-label')).toBe('Кто видит');
    const bubble = root.querySelector('h1 .top-tip .tip-bubble[role="tooltip"]');
    expect(bubble?.textContent).toBe('Дневник виден только вам: работодатель его не видит.');
    expect(button?.getAttribute('aria-describedby')).toBe(bubble?.id);
    button?.focus();
    expect(document.activeElement).toBe(button);
    click(button);
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    press(document, 'Escape');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
  });
});

function ChromeProbe({ code }: { readonly code: string }) {
  useDiaryTitleTip(nodeByCode(code)!);
  return <output>{useShell().chrome.titleTip ?? 'нет'}</output>;
}

describe('useDiaryTitleTip', () => {
  it('ⓘ на экранах с заголовком «Дневник», на вложенных — нет', () => {
    for (const code of ['d00', 'd00d', 'd02', 'd01', 'd04']) {
      const root = render(<ChromeProbe code={code} />);
      expect(root.querySelector('output')?.textContent, code).toBe(DIARY_TITLE_TIP);
      view?.unmount();
      view = null;
    }
    for (const code of ['d02b', 'd01c']) {
      const root = render(<ChromeProbe code={code} />);
      expect(root.querySelector('output')?.textContent, code).toBe('нет');
      view?.unmount();
      view = null;
    }
  });
});
