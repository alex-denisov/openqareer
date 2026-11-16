import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { VacancyConnectionCircles } from '../../../vacancies/vacancyLetterApi';
import { acquaintancesOf } from './acquaintances';
import { AcquaintBlock } from './AcquaintBlock';

vi.mock('../../shell/ShellContext', () => ({
  useShell: () => ({ navigate: () => undefined }),
  useScreenChrome: () => undefined,
}));

const person = (id: string, fullName: string, roleTitle: string | null) => ({
  id,
  fullName,
  roleTitle,
  companyName: 'Ладога',
});

function circles(): VacancyConnectionCircles {
  return {
    vacancyId: 'v',
    companyKey: 'ladoga',
    companyName: 'Ладога',
    vacancyTitle: 'Head',
    linkedinImport: { state: 'imported', importedAt: null, importedCount: null },
    circles: [
      {
        circle: 1,
        state: 'available',
        message: '',
        paths: [
          {
            id: 'p1',
            circle: 1,
            path: [],
            recipient: person('r1', 'Роман Ефимов', 'руководитель группы платежей'),
            evidence: [],
            strength: 'direct',
            source: 'linkedin_import',
            nextStep: 'write_known_contact',
          },
        ],
      },
      {
        circle: 2,
        state: 'available',
        message: '',
        paths: [],
        platformMembers: {
          count: 1,
          members: [{ fullName: 'Секретная Участница', linkedinUrl: 'https://linkedin.com/in/secret', personName: 'Скрытый Человек' }],
        },
      },
    ],
  };
}

describe('acquaintancesOf', () => {
  it('люди из кругов и участники платформы обезличены', () => {
    const people = acquaintancesOf(circles());
    expect(people).toEqual([
      { key: 'r1', name: 'Роман Ефимов', sub: 'руководитель группы платежей · 1-й круг' },
      { key: 'platform-0', name: 'Участник платформы', sub: '2-й круг' },
    ]);
  });

  it('холодные пути знакомыми не считаются; пусто — пустой список', () => {
    const data = circles();
    const cold = { ...data, circles: [{ ...data.circles[0]!, paths: [{ ...data.circles[0]!.paths[0]!, source: 'cold' as const }] }] };
    expect(acquaintancesOf(cold)).toEqual([]);
    expect(acquaintancesOf(undefined)).toEqual([]);
  });
});

describe('AcquaintBlock', () => {
  it('участник платформы: ни имени, ни ссылки, ни слова о согласии в разметке', () => {
    const html = renderToStaticMarkup(<AcquaintBlock people={acquaintancesOf(circles())} />);
    expect(html).toContain('Участник платформы');
    expect(html).toContain('Знакомые в компании · 2');
    for (const leak of ['Секретная', 'Скрытый', 'linkedin.com', 'согласи']) {
      expect(html).not.toContain(leak);
    }
  });

  it('никого нет — блока нет', () => {
    expect(renderToStaticMarkup(<AcquaintBlock people={[]} />)).toBe('');
  });
});
