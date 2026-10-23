import { SpinnerGap } from '@phosphor-icons/react';

const PLATFORM_NAMES = { hh: 'hh.ru', linkedin: 'LinkedIn' } as const;

/**
 * Shown in the window area while the native sign-in window is still hidden: it
 * appears only once its page has loaded (B464), so the candidate reads what is
 * happening instead of a blank rectangle. Visible again if the window is moved
 * away or minimised (B157).
 */
export function ConnectorWindowPlaceholder({
  platform,
}: {
  readonly platform: keyof typeof PLATFORM_NAMES;
}) {
  const name = PLATFORM_NAMES[platform];
  return (
    <div className="career-connector-webview-placeholder" role="status">
      <p>
        <SpinnerGap size={16} className="spin" aria-hidden="true" /> Загружаем страницу {name}…
      </p>
      <p>
        Окно входа {name} появится здесь. Если его не видно, оно может быть свёрнуто или за другим
        окном — найдите его и завершите вход.
      </p>
    </div>
  );
}
