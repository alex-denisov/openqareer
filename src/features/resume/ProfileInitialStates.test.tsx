// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileMobileEmptyResume, ProfileMobileTabs } from './ProfileMobileHome';
import { ProfileScreenSurface, type ProfileScreenSurfaceProps } from './ProfileScreenView';
import { ProfileTabs } from './profileTabs';
import type { ResumeDraft } from './resumeTypes';

const emptyDraft: ResumeDraft = {
  candidate: {},
  experience: [],
  education: [],
  languages: [],
};

const baseProps: ProfileScreenSurfaceProps = {
  candidateId: 'candidate-empty-state-test',
  memory: [],
  draft: emptyDraft,
  onRetry: vi.fn(),
  onDraftChange: vi.fn(),
  onSectionSave: vi.fn(),
  onOpenConnections: vi.fn(),
};

const mounted: Array<{
  readonly root: ReturnType<typeof createRoot>;
  readonly container: HTMLElement;
}> = [];

function setViewport(desktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: desktop,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function mount(node: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
  return container;
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe('profile initial states', () => {
  it.each([true, false])(
    'keeps summary and disabled tabs during loading (desktop=%s)',
    (desktop) => {
      setViewport(desktop);
      const html = renderLoadingMarkup();

      expect(html).toContain('career-profile-screen-loading-summary');
      expect(html).toContain('role="tablist"');
      expect(html.match(/disabled=""/gu) ?? []).toHaveLength(3);
      expect(html).toContain('career-profile-screen-loading-bar');
      expect(html).toContain('Загружаем профиль…');
      expect(html).not.toContain('Имя не указано');
      expect(html).not.toContain('profile-screen-tab-count');
    },
  );

  it('shows the mobile empty prompt only when no draft or confirmed profile fact exists', () => {
    setViewport(false);
    const emptyHtml = renderToStaticMarkup(<ProfileScreenSurface {...baseProps} />);
    const languageOnlyDraft: ResumeDraft = {
      ...emptyDraft,
      languages: [{ id: 'language-1', evidenceMemoryId: 'memory-language-1', name: 'Английский' }],
    };
    const contentHtml = renderToStaticMarkup(
      <ProfileScreenSurface {...baseProps} draft={languageOnlyDraft} />,
    );
    const memoryHtml = renderToStaticMarkup(
      <ProfileScreenSurface
        {...baseProps}
        memory={[
          {
            id: 'memory-responsibility',
            kind: 'fact',
            domain: 'responsibility',
            statement: 'Собрал платформенную команду.',
            confidence: 'candidate-confirmed',
            sourceMessageIds: ['message-1'],
            sensitive: false,
            status: 'confirmed',
          },
        ]}
      />,
    );

    expect(emptyHtml).toContain('Профиль пуст.');
    expect(emptyHtml).toContain('Загрузить резюме');
    expect(emptyHtml).toContain('Заполнить профиль вручную');
    expect(contentHtml).not.toContain('Профиль пуст.');
    expect(memoryHtml).not.toContain('Профиль пуст.');
  });

  it('names the current role and employer under the 390 name, not the whole imported headline', () => {
    setViewport(false);
    const container = mount(
      <ProfileScreenSurface
        {...baseProps}
        draft={{
          ...emptyDraft,
          candidate: {
            fullName: 'Андрей Лебедев',
            headline:
              'Маркет Софт, Санкт-Петербург — Директор по разработке · Финтех Лаб, Москва — Head of Engineering',
          },
          experience: [
            {
              id: 'work-1',
              chronologyMemoryId: 'memory-work-1',
              title: 'Head of Engineering',
              employer: 'Финтех Лаб',
              startDate: '2021-03',
              current: true,
              bulletMemoryIds: [],
            },
          ],
        }}
      />,
    );
    expect(container.querySelector('.pm-id p')?.textContent).toBe(
      'Head of Engineering · Финтех Лаб',
    );
  });

  it('follows mockup 2 «Пусто»: upload, consultant, and the source link in the copy', () => {
    const open = vi.fn();
    const onOpenConnections = vi.fn();
    const onOpenExpert = vi.fn();
    const container = mount(
      <ProfileMobileEmptyResume
        open={open}
        onOpenConnections={onOpenConnections}
        onOpenExpert={onOpenExpert}
      />,
    );
    const button = (text: string) =>
      Array.from(container.querySelectorAll('button')).find((item) =>
        item.textContent?.includes(text),
      );

    expect(container.textContent).toContain(
      'Профиль пуст. Подключите источник или загрузите резюме.',
    );
    expect(button('Загрузить резюме')).toBeDefined();
    expect(container.querySelector('input[type="file"]')?.getAttribute('accept')).toContain(
      '.docx',
    );
    act(() => button('Подключите источник')?.click());
    act(() => button('Рассказать консультанту')?.click());

    expect(onOpenConnections).toHaveBeenCalledOnce();
    expect(onOpenExpert).toHaveBeenCalledOnce();
    expect(button('Заполнить профиль вручную')).toBeUndefined();
  });

  it('falls back to manual filling when the consultant is unavailable', () => {
    const open = vi.fn();
    const container = mount(<ProfileMobileEmptyResume open={open} />);
    const manual = Array.from(container.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Заполнить профиль вручную'),
    );
    act(() => manual?.click());
    expect(open).toHaveBeenCalledWith({ page: 'contacts' });
  });

  it('prevents desktop and mobile tab changes while the profile data is unavailable', () => {
    const desktopOnTab = vi.fn();
    const mobileOnTab = vi.fn();
    const desktop = mount(<ProfileTabs tab="resume" onTab={desktopOnTab} disabled />);
    const mobile = mount(<ProfileMobileTabs activeTab="resume" onTab={mobileOnTab} disabled />);

    const desktopTabs = Array.from(desktop.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const mobileTabs = Array.from(mobile.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(desktopTabs.every((tab) => tab.disabled)).toBe(true);
    expect(mobileTabs.every((tab) => tab.disabled)).toBe(true);
    act(() => {
      desktopTabs.forEach((tab) => tab.click());
      mobileTabs.forEach((tab) => tab.click());
    });
    expect(desktopOnTab).not.toHaveBeenCalled();
    expect(mobileOnTab).not.toHaveBeenCalled();
  });
});

function renderLoadingMarkup() {
  return renderToStaticMarkup(<ProfileScreenSurface {...baseProps} loading draft={undefined} />);
}
