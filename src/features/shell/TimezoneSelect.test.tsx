// @vitest-environment jsdom
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TimezoneSelect } from './TimezoneSelect';
import { COMMON_TIMEZONES, formatTimezoneOffset } from '../../../shared/timezoneUtils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('TimezoneSelect (B332)', () => {
  it('renders a native select inside a label with title «Часовой пояс» and name', () => {
    const html = renderToStaticMarkup(<TimezoneSelect name="timezone" />);
    expect(html).toContain('<label');
    expect(html).toContain('Часовой пояс');
    expect(html).toContain('<select');
    expect(html).toContain('name="timezone"');
  });

  it('renders common timezone list with calculated offsets including negative ones', () => {
    const html = renderToStaticMarkup(
      <TimezoneSelect name="timezone" deviceTimezone="Europe/Moscow" />,
    );
    // Проверяем наличие всех 25 зон
    for (const item of COMMON_TIMEZONES) {
      expect(html).toContain(`value="${item.timezone}"`);
    }
    // Отрицательное смещение (Нью-Йорк)
    const nyOffset = formatTimezoneOffset('America/New_York');
    expect(nyOffset).toMatch(/^UTC[-−]\d+/);
    expect(html).toContain(`Нью-Йорк (${nyOffset})`);
  });

  it('marks device timezone without duplicate when device is in common list', () => {
    const html = renderToStaticMarkup(
      <TimezoneSelect name="timezone" deviceTimezone="Europe/Moscow" />,
    );
    // Должна быть ровно одна опция Europe/Moscow
    const moscowMatches = html.match(/value="Europe\/Moscow"/g);
    expect(moscowMatches).toHaveLength(1);
    expect(html).toContain('Москва (UTC+3) — как на этом устройстве');
  });

  it('adds device option at top when device is not in common list', () => {
    const html = renderToStaticMarkup(
      <TimezoneSelect name="timezone" deviceTimezone="Asia/Tokyo" />,
    );
    // Токио нет в списке 25 городов, должен появиться вверху как устройство
    expect(html).toContain('Как на этом устройстве — Tokyo (UTC+9)');
    const tokyoMatches = html.match(/value="Asia\/Tokyo"/g);
    expect(tokyoMatches).toHaveLength(1);

    // И постоянный список тоже присутствует
    expect(html).toContain('value="Europe/Moscow"');
    expect(html).toContain('Москва (UTC+3)');
  });

  it('shows unlisted saved value as a separate option at the top', () => {
    const html = renderToStaticMarkup(
      <TimezoneSelect
        name="timezone"
        defaultValue="America/Chicago"
        deviceTimezone="Europe/Moscow"
      />,
    );
    // America/Chicago нет в списке, должна быть отдельной опцией вверху
    expect(html).toMatch(/<option value="America\/Chicago"[^>]*>America\/Chicago \(UTC[-−]\d+\)<\/option>/);
    // И устройство отмечено
    expect(html).toContain('Москва (UTC+3) — как на этом устройстве');
  });

  it('does not duplicate unlisted saved value if it equals device timezone', () => {
    const html = renderToStaticMarkup(
      <TimezoneSelect
        name="timezone"
        defaultValue="Asia/Tokyo"
        deviceTimezone="Asia/Tokyo"
      />,
    );
    const tokyoMatches = html.match(/value="Asia\/Tokyo"/g);
    expect(tokyoMatches).toHaveLength(1);
    expect(html).toContain('Как на этом устройстве — Tokyo (UTC+9)');
  });

  it('панель аккаунта отправляет выбранное значение', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const onSave = vi.fn();

    function AccountFormMock() {
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            onSave(form.get('timezone'));
          }}
        >
          <TimezoneSelect name="timezone" defaultValue="Europe/Moscow" />
          <button type="submit">Сохранить часовой пояс</button>
        </form>
      );
    }

    await act(async () => {
      root.render(<AccountFormMock />);
    });

    const select = container.querySelector('select')!;
    expect(select).not.toBeNull();
    expect(select.value).toBe('Europe/Moscow');

    // Пользователь выбирает Берлин
    await act(async () => {
      select.value = 'Europe/Berlin';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(onSave).toHaveBeenCalledWith('Europe/Berlin');

    root.unmount();
    container.remove();
  });

  it('админка отправляет выбранное значение', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const onAddAccount = vi.fn();

    function AdminFormMock() {
      const [accountTimezone, setAccountTimezone] = useState('Europe/Moscow');
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAddAccount({
              adminLabel: 'test@example.com',
              timezone: accountTimezone || undefined,
            });
          }}
        >
          <TimezoneSelect
            name="timezone"
            value={accountTimezone}
            onChange={(e) => setAccountTimezone(e.target.value)}
          />
          <button type="submit">Добавить аккаунт</button>
        </form>
      );
    }

    await act(async () => {
      root.render(<AdminFormMock />);
    });

    const select = container.querySelector('select')!;
    expect(select.value).toBe('Europe/Moscow');

    // Админ меняет пояс на Самару
    await act(async () => {
      select.value = 'Europe/Samara';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(onAddAccount).toHaveBeenCalledWith({
      adminLabel: 'test@example.com',
      timezone: 'Europe/Samara',
    });

    root.unmount();
    container.remove();
  });
});
