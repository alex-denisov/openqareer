import { useEffect, useRef } from 'react';
import {
  WebAuthnAbortService,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
} from '@simplewebauthn/browser';
import type { AuthUser } from '../coach/coachApi';
import { fetchPasskeyLoginOptions, loginWithPasskey } from '../coach/passkeyLoginApi';

/**
 * B755: вход ключом доступа через подсказку браузера в поле почты (conditional mediation).
 * Без поддержки, при отмене и при любой ошибке молчит: на экране входа ничего не появляется.
 * Пароль и форма остаются как были; при уходе со страницы ожидание ключа отменяется.
 */
export function usePasskeyAutofill(onSignedIn: (user: AuthUser) => void, enabled: boolean): void {
  const signedIn = useRef(onSignedIn);
  useEffect(() => {
    signedIn.current = onSignedIn;
  }, [onSignedIn]);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    async function listen() {
      try {
        if (!(await browserSupportsWebAuthnAutofill())) return;
        const { options, token } = await fetchPasskeyLoginOptions();
        if (!active) return;
        const assertion = await startAuthentication({
          optionsJSON: options,
          useBrowserAutofill: true,
        });
        if (!active) return;
        const user = await loginWithPasskey(token, assertion);
        if (active) signedIn.current(user);
      } catch {
        // Подсказка ключа — необязательная часть входа: сбой не должен ничего показывать.
      }
    }
    void listen();
    return () => {
      active = false;
      WebAuthnAbortService.cancelCeremony();
    };
  }, [enabled]);
}
