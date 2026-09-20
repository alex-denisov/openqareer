/** Browser-only test adapter. Route fixtures still supply HTTP data, but the
 * application receives the same IPC response envelope as the native runtime.
 * The setter supports either ordering of Playwright init scripts. */
export function installDesktopApiTestBridge() {
  let bridge = window.__TAURI_INTERNALS__;
  const wrap = (value) => {
    if (!value) return value;
    const original = value.invoke;
    return {
      ...value,
      async invoke(command, args) {
        if (command !== 'desktop_native_fetch') return original?.(command, args) ?? null;
        const { url, ...init } = args.request;
        const response = await fetch(url, init);
        return {
          status: response.status,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.text(),
        };
      },
    };
  };
  bridge = wrap(bridge);
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    get: () => bridge,
    set: (value) => { bridge = wrap(value); },
  });
}
