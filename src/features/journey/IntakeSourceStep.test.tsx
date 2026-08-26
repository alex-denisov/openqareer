import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IntakeSourceStep, type IntakeSourceStepProps } from './IntakeSourceStep';
import { intakeSourceLock } from './intakeSourceLock';

const noop = () => undefined;

function baseProps(): IntakeSourceStepProps {
  return {
    isDesktop: true,
    sourceChoice: 'profile-import',
    onChooseSource: noop,
    lock: {},
    onReleaseSource: noop,
    onDisconnectPlatform: noop,
    busy: false,
    resumeText: '',
    onResumeText: noop,
    onPickPdf: noop,
    linkedinOpen: false,
    hhOpen: false,
    onLinkedinOpen: noop,
    onHhOpen: noop,
    onLinkedinImported: noop,
    onProviderConnectionFailure: noop,
    onHhConnected: noop,
    onHhAuthenticatedEmpty: noop,
    hhConnected: false,
    linkedinConnected: false,
  };
}

/** Signed in to hh.ru, nothing imported into the profile yet. */
function renderSignedInWithoutImportedResume(): string {
  return renderToStaticMarkup(
    <IntakeSourceStep
      {...baseProps()}
      lock={intakeSourceLock({ connectedPlatform: 'hh', typedLength: 0 })}
      hhConnected
    />,
  );
}

/** The chosen hh.ru resume is in the candidate profile, as the server holds it. */
function renderImportedHhProfile(): string {
  return renderToStaticMarkup(
    <IntakeSourceStep
      {...baseProps()}
      lock={intakeSourceLock({ connectedPlatform: 'hh', typedLength: 0 })}
      hhConnected
      connectedSource={{
        platform: 'hh',
        factCount: 12,
        lastImportedAt: '2026-08-26T00:00:00.000Z',
      }}
    />,
  );
}

describe('hh.ru in the intake wizard', () => {
  /**
   * The picker used to stand here, outliving both the dialog and the sign-in
   * window it read through; pressing it after the candidate closed that window
   * produced «Импортировать выбранное резюме не удалось» with no cause
   * (owner report, 2026-08-26). The choice now belongs to the dialog.
   */
  it('never offers a resume import outside the dialog that owns the session', () => {
    expect(renderSignedInWithoutImportedResume()).not.toContain(
      'Импортировать выбранное резюме',
    );
    expect(renderImportedHhProfile()).not.toContain('Импортировать выбранное резюме');
  });

  it('offers the restored LinkedIn connector under the same session-import contract', () => {
    const html = renderSignedInWithoutImportedResume();

    expect(html).toContain('Импорт опыта и навыков');
    expect(html).toContain('>Подключить</button>');
  });

  it('offers the release control as soon as a platform is connected', () => {
    const html = renderSignedInWithoutImportedResume();

    expect(html).toContain('Сменить источник');
    expect(html).toContain('уже подключён');
  });

  it('lets the candidate sign out of a connected platform from its own card', () => {
    const html = renderImportedHhProfile();

    // «Отключить» takes the place of «Подключить»; there is no second, quieter
    // sign-out hidden inside the session dialog (owner report, 2026-08-26).
    expect(html).toContain('>Отключить</button>');
    expect(html).not.toContain('Обновить импорт');
  });

  it('never claims the profile import produced a parsed document banner', () => {
    expect(renderImportedHhProfile()).not.toContain('Резюме разобрано');
  });
});
