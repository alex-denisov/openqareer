import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OnboardingReviewStep } from './OnboardingReviewStep';

const noop = () => undefined;

describe('OnboardingReviewStep', () => {
  it('lists every row with its source, tag and a way to correct it', () => {
    const html = renderToStaticMarkup(
      <OnboardingReviewStep
        rows={[
          {
            id: 'job-0',
            title: 'VP of Technology & Operations · OptiLab AI',
            subtitle: 'ноябрь 2025 — наст. время · из резюме',
            tag: { tone: 'warning', label: '1 из 4 пунктов с числом' },
          },
        ]}
        editingId={undefined}
        onStartEdit={noop}
        onCancelEdit={noop}
        draftValue=""
        onDraftChange={noop}
        onSaveEdit={noop}
      />,
    );
    expect(html).toContain('VP of Technology &amp; Operations · OptiLab AI');
    expect(html).toContain('из резюме');
    expect(html).toContain('1 из 4 пунктов с числом');
    expect(html).toContain('Исправить');
  });

  it('shows an honest empty state when nothing was found to review', () => {
    const html = renderToStaticMarkup(
      <OnboardingReviewStep
        rows={[]}
        editingId={undefined}
        onStartEdit={noop}
        onCancelEdit={noop}
        draftValue=""
        onDraftChange={noop}
        onSaveEdit={noop}
      />,
    );
    expect(html).toContain('Пока нечего проверять');
  });

  it('opens an inline correction field for the row being edited', () => {
    const html = renderToStaticMarkup(
      <OnboardingReviewStep
        rows={[
          { id: 'job-0', title: 'A', subtitle: 'B' },
        ]}
        editingId="job-0"
        onStartEdit={noop}
        onCancelEdit={noop}
        draftValue="Исправленный текст"
        onDraftChange={noop}
        onSaveEdit={noop}
      />,
    );
    expect(html).toContain('Исправленный текст');
    expect(html).toContain('Сохранить');
  });
});
