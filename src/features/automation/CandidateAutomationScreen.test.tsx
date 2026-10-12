import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CandidateAutomationScreen } from './CandidateAutomationScreen';

describe('CandidateAutomationScreen', () => {
  it('shows the three approved sections and a loading state before candidate data arrives', () => {
    const html = renderToStaticMarkup(
      <CandidateAutomationScreen
        candidateId="candidate-test"
        onOpenConsultant={() => undefined}
        onOpenConnections={() => undefined}
        onOpenTariffs={() => undefined}
      />,
    );

    expect(html).toContain('Автоотклики');
    expect(html).toContain('Посты LinkedIn');
    expect(html).toContain('Журнал');
    expect(html).toContain('aria-busy="true"');
  });
});
