// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from './adminApi';
import { CoachApiError } from '../coach/apiClient';
import { AdminCreateAccount, generatePassword } from './AdminCreateAccount';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('AdminCreateAccount', () => {
  let host: HTMLDivElement;
  let root: Root;
  const onCreated = vi.fn();

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    onCreated.mockClear();
    act(() => root.render(<AdminCreateAccount onCreated={onCreated} />));
    act(() => host.querySelector('button')!.click());
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  const input = (id: string) => host.querySelector<HTMLInputElement>(`#${id}`)!;
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;

  it('sends the fields, a generated password and the tariff, then shows the password once', async () => {
    const create = vi.spyOn(adminApi, 'createAdminAccount').mockResolvedValue({
      id: 'u1',
      username: 'qa',
      email: 'qa@openqareer.test',
    } as adminApi.AdminUser);
    act(() => type(input('create-email'), 'qa@openqareer.test'));
    act(() => type(input('create-name'), 'Тест Кандидат'));
    act(() => button('Сгенерировать').click());
    const password = input('create-password').value;
    expect(password).toHaveLength(16);
    const tier = host.querySelector<HTMLSelectElement>('#create-tier')!;
    act(() => {
      tier.value = 'pro';
      tier.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => button('Создать').click());

    expect(create).toHaveBeenCalledWith({
      email: 'qa@openqareer.test',
      displayName: 'Тест Кандидат',
      password,
      emailVerified: true,
      subscriptionTier: 'pro',
    });
    expect(onCreated).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Аккаунт создан: qa@openqareer.test');
    expect(host.textContent).toContain(password);
  });

  it('shows the server field message for a taken address', async () => {
    vi.spyOn(adminApi, 'createAdminAccount').mockRejectedValue(
      new CoachApiError('Этот email уже связан с другим аккаунтом.', 'email_taken', false, {
        email: 'Этот email уже связан с другим аккаунтом.',
      }),
    );
    await act(async () => button('Создать').click());
    expect(input('create-email').getAttribute('aria-invalid')).toBe('true');
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe('generatePassword', () => {
  it('passes the shared password rule length and varies', () => {
    expect(generatePassword()).not.toBe(generatePassword());
    expect(generatePassword().length).toBeGreaterThanOrEqual(8);
  });
});
