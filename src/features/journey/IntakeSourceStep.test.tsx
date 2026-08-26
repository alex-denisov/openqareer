import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IntakeSourceStep, type IntakeSourceStepProps } from './IntakeSourceStep';
import { intakeSourceLock } from './intakeSourceLock';

const noop = () => undefined;

const HH_RESUME = {
  id: 'resume-selected',
  title: 'Руководитель продукта',
  url: 'https://hh.ru/resume/resume-selected',
};

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
    hhResumes: [],
    selectedHhResumeId: '',
    onSelectHhResume: noop,
    onImportHhResume: noop,
    hhConnected: false,
    linkedinConnected: false,
  };
}

/** Signed in to hh.ru, resume list read, nothing imported into the profile yet. */
function renderHhListWithoutImportedResume(): string {
  return renderToStaticMarkup(
    <IntakeSourceStep
      {...baseProps()}
      lock={intakeSourceLock({ connectedPlatform: 'hh', typedLength: 0 })}
      hhResumes={[HH_RESUME]}
      selectedHhResumeId={HH_RESUME.id}
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
      hhResumes={[HH_RESUME]}
      selectedHhResumeId={HH_RESUME.id}
      hhConnected
      connectedSource={{
        platform: 'hh',
        factCount: 12,
        lastImportedAt: '2026-08-26T00:00:00.000Z',
      }}
    />,
  );
}

describe('hh.ru resume selection in the intake wizard', () => {
  it('offers an import action after the list is found but before a resume is imported', () => {
    const html = renderHhListWithoutImportedResume();

    expect(html).toContain('Импортировать выбранное резюме');
    expect(html).toContain('Руководитель продукта');
  });

  it('offers the restored LinkedIn connector under the same session-import contract', () => {
    const html = renderHhListWithoutImportedResume();

    expect(html).toContain('Импорт опыта и навыков');
    expect(html).toContain('>Подключить</button>');
  });

  it('offers the release control as soon as a platform is connected', () => {
    const html = renderHhListWithoutImportedResume();

    expect(html).toContain('Сменить источник');
    expect(html).toContain('уже подключён');
  });

  it('replaces the resume picker with the release control once the import is stored', () => {
    const html = renderImportedHhProfile();

    expect(html).not.toContain('Импортировать выбранное резюме');
    expect(html).toContain('Сменить источник');
  });

  it('lets the candidate sign out of a connected platform from its own card', () => {
    const html = renderImportedHhProfile();

    // «Отключить» takes the place of «Подключить»; there is no second, quieter
    // sign-out hidden inside the session dialog (owner report, 2026-08-26).
    expect(html).toContain('>Отключить</button>');
    expect(html).not.toContain('Обновить импорт');
  });

  it('never claims the profile import produced a parsed document banner', () => {
    const html = renderImportedHhProfile();

    expect(html).not.toContain('Резюме разобрано');
  });
});
