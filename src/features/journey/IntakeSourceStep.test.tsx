import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IntakeSourceStep, type IntakeSourceStepProps } from './IntakeSourceStep';

const noop = () => undefined;

function renderHhListWithoutImportedResume(): string {
  const props: IntakeSourceStepProps = {
    isDesktop: true,
    sourceChoice: 'profile-import',
    onChooseSource: noop,
    lock: {},
    onReleaseSource: noop,
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
    hhResumes: [
      {
        id: 'resume-selected',
        title: 'Руководитель продукта',
        url: 'https://hh.ru/resume/resume-selected',
      },
    ],
    selectedHhResumeId: 'resume-selected',
    onSelectHhResume: noop,
    onImportHhResume: noop,
    hhConnected: true,
    linkedinConnected: false,
  };
  return renderToStaticMarkup(<IntakeSourceStep {...props} />);
}

describe('hh.ru resume selection in the intake wizard', () => {
  it('offers an import action after the list is found but before a resume is imported', () => {
    const html = renderHhListWithoutImportedResume();

    expect(html).toContain('Импортировать выбранное резюме');
    expect(html).toContain('Руководитель продукта');
    expect(html).not.toContain('career-platform-card is-connected');
  });

  it('offers the restored LinkedIn connector under the same session-import contract', () => {
    const html = renderHhListWithoutImportedResume();

    expect(html).toContain('Импорт опыта и навыков');
    expect(html).toContain('>Подключить</button>');
  });
});
