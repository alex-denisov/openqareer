import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HhSkillQuizSimulator } from './HhSkillQuizSimulator';

describe('HhSkillQuizSimulator', () => {
  it('renders skill quiz catalog with available tests', () => {
    const html = renderToStaticMarkup(<HhSkillQuizSimulator onClose={() => undefined} />);

    expect(html).toContain('Верификация навыков hh.ru');
    expect(html).toContain('TypeScript');
    expect(html).toContain('React');
    expect(html).toContain('Node.js');
    expect(html).toContain('Начать тест');
  });
});
