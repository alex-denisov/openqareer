// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResumeBuilderPage } from './ResumeBuilderPage';
import {
  readBuilderState,
  RESUME_BUILDER_STORAGE_KEY,
  authReturnPath,
} from './resumeBuilderStorage';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  window.localStorage.clear();
});

function mount(onNavigate = vi.fn()) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<ResumeBuilderPage onNavigate={onNavigate} />));
  return { host, onNavigate };
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === name,
  );
  if (!found) throw new Error(`no button «${name}»`);
  return found;
}

describe('/tools/resume first paint (B567)', () => {
  it('shows the sample in the strict template, three templates and no photo', () => {
    const html = renderToStaticMarkup(<ResumeBuilderPage onNavigate={() => {}} />);
    expect((html.match(/<h1[ >]/gu) ?? []).length).toBe(1);
    expect(html).toContain('sheet t-strict');
    expect(html).toContain('Анна Соколова');
    expect(html).toContain('Загрузить готовое');
    expect(html).not.toContain('С фото');
    expect(html).not.toContain('Загрузить старое');
    expect((html.match(/aria-pressed=/gu) ?? []).length).toBe(3);
    expect(html).toContain('3/4');
    expect((html.match(/itemProp="mainEntity"/gu) ?? []).length).toBe(7);
  });

  it('links to interview questions and resume FAQ, as on the mockup', () => {
    const html = renderToStaticMarkup(<ResumeBuilderPage onNavigate={() => {}} />);
    // The site footer links to interview questions too; count the page body only.
    const body = html.slice(0, html.indexOf('<footer'));
    expect((body.match(/href="\/tools\/interview-questions"/gu) ?? []).length).toBe(2);
    expect((body.match(/href="\/faq#resume"/gu) ?? []).length).toBe(2);
    expect(html).toContain('Вопросы на собеседовании по вашей профессии');
    expect(html).not.toContain('Сколько будет на руки');
    expect(html).toContain('class="rb-hide-m"');
  });
});

describe('/tools/resume interaction (B567)', () => {
  it('switches the template and keeps typed data across a reload', () => {
    const { host } = mount();
    act(() => button(host, 'Современный').click());
    expect(host.querySelector('.sheet')?.className).toContain('t-modern');
    act(() => button(host, 'Создать резюме').click());
    const title = host.querySelector<HTMLInputElement>('#rb-title')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(title, 'Аналитик данных');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('.sheet .role')?.textContent).toBe('Аналитик данных');
    expect(readBuilderState()).toMatchObject({
      template: 'modern',
      resume: { title: 'Аналитик данных' },
    });
  });

  it('signed out, a download stores the resume and goes to sign-up, which returns here', () => {
    const { host, onNavigate } = mount();
    act(() => button(host, 'DOCX').click());
    expect(onNavigate).toHaveBeenCalledWith('/signup?from=resume&export=docx');
    expect(JSON.parse(window.localStorage.getItem(RESUME_BUILDER_STORAGE_KEY)!)).toMatchObject({
      pendingExport: 'docx',
      resume: { fullName: 'Анна Соколова' },
    });
    expect(authReturnPath('')).toBe('/tools/resume');
    window.localStorage.clear();
    expect(authReturnPath('?from=resume')).toBe('/tools/resume');
    expect(authReturnPath('')).toBe('/app');
  });
});
