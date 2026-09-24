import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OnboardingTalkStep } from './OnboardingTalkStep';

const noop = () => undefined;

describe('OnboardingTalkStep', () => {
  it('asks the three mockup questions about tasks, not job titles', () => {
    const html = renderToStaticMarkup(
      <OnboardingTalkStep
        tasks=""
        change=""
        successMeasure=""
        onChange={noop}
      />,
    );
    expect(html).toContain('Что вы реально делали на последнем месте');
    expect(html).toContain('Что хочется изменить в следующей роли');
    expect(html).toContain('Какой результат через год вы сочтёте успехом');
  });

  it('renders whatever the candidate has already typed', () => {
    const html = renderToStaticMarkup(
      <OnboardingTalkStep
        tasks="Вёл переговоры с 12 поставщиками"
        change="Меньше операционки"
        successMeasure=""
        onChange={noop}
      />,
    );
    expect(html).toContain('Вёл переговоры с 12 поставщиками');
    expect(html).toContain('Меньше операционки');
  });
});
