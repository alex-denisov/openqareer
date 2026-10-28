// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PublicToolsMenu } from './PublicToolsMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('B574: «Инструменты» dropdown', () => {
  let root: Root;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div><p id="outside">x</p>';
    root = createRoot(document.getElementById('app')!);
    act(() => root.render(<PublicToolsMenu where="nav" current />));
  });
  afterEach(() => act(() => root.unmount()));

  const trigger = () => document.querySelector<HTMLAnchorElement>('.ps-tools-trigger')!;

  it('draws the six tools on click and closes on Escape with focus on the trigger', () => {
    expect(trigger().getAttribute('href')).toBe('/#tools');
    expect(trigger().getAttribute('aria-current')).toBe('true');
    expect(document.querySelector('.ps-tools-menu')).toBeNull();
    act(() => trigger().click());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('#ps-tools-menu a')).toHaveLength(6);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(document.querySelector('.ps-tools-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('opens with Space and closes on a click outside', () => {
    act(() => {
      trigger().dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(document.querySelector('#ps-tools-menu')).not.toBeNull();
    act(() => document.getElementById('outside')!.click());
    expect(document.querySelector('#ps-tools-menu')).toBeNull();
  });
});
