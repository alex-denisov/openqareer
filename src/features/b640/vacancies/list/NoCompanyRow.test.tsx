// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '../../kit/testDom';
import { companyNodePath } from '../companyPath';
import { makeItem } from './fixtures';
import { RowBoundary } from './RowBoundary';
import { VacancyTable, type VacancyTableProps } from './VacancyTable';

vi.mock('../../shell/ShellContext', () => ({
  useShell: () => ({ navigate: vi.fn() }),
}));

const noop = () => undefined;
const actions = {
  want: async () => undefined,
  hide: async () => undefined,
  applied: async () => undefined,
};

function table(items: VacancyTableProps['items'], openId: string | null = null): string {
  const props = {
    items,
    env: { currency: 'RUB', noRole: false },
    openId,
    menu: null,
    sort: { key: 'date', direction: 'desc' },
    onSort: noop,
    moneyTip: null,
    byCluster: new Map(),
    wantedKeys: new Set<string>(),
    actionsFor: () => actions,
    onToggleOpen: noop,
    onToggleSaved: noop,
    onMenu: noop,
    onCloseMenu: noop,
  } as unknown as VacancyTableProps;
  return renderToStaticMarkup(<VacancyTable {...props} />);
}

describe('B726 · вакансия без компании (Telegram, canonicalCompany "")', () => {
  it('пути карточки компании нет: пустое имя или одни знаки', () => {
    expect(companyNodePath('')).toBeNull();
    expect(companyNodePath('  — ')).toBeNull();
    expect(companyNodePath(null)).toBeNull();
    expect(companyNodePath('Ладога Банк')).toBe(
      `/app/vacancies/companies/${encodeURIComponent('ладогабанк')}`,
    );
  });

  it('строка и её раскрытие: компания текстом без ссылки, таблица на месте', () => {
    const withCompany = makeItem({ id: 'v1', title: 'CTO', company: 'Ладога Банк' });
    const bare = makeItem({
      id: 'v2',
      title: 'Технический директор / Tech lead / CTO',
      company: '',
    });
    const out = table([withCompany, bare], 'v2');
    expect(out).toContain('<span class="vt-co">Компания не указана</span>');
    expect(out).toContain('Технический директор / Tech lead / CTO');
    expect(out.match(/href="\/app\/vacancies\/companies\/[^"]*"/gu)).toEqual([
      `href="/app/vacancies/companies/${encodeURIComponent('ладогабанк')}"`,
    ]);
  });
});

function Broken(): never {
  throw new Error('bad row');
}

describe('B726 · сбой одной строки не роняет таблицу', () => {
  it('вместо строки — её название', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = mount(
      <table>
        <tbody>
          <RowBoundary title="Руководитель разработки">
            <Broken />
          </RowBoundary>
        </tbody>
      </table>,
    );
    spy.mockRestore();
    expect(view.container.querySelector('td')?.textContent).toBe('Руководитель разработки');
    view.unmount();
  });
});

describe('B726 · карточка вакансии без компании', () => {
  it('шапка: компания текстом, без ссылки на v10b', async () => {
    const { Head } = await import('../card/Head');
    const item = makeItem({ id: 'v2', title: 'CTO', company: '' });
    const html = renderToStaticMarkup(<Head item={item} companyPath={null} save={null} />);
    expect(html).toContain('Компания не указана');
    expect(html).not.toContain('href=');
  });
});

/** B726 (B645, prod 23.11): у поста Telegram без компании «О компании» раскрывался пустым. */
describe('B726 · карточка v04 без компании', () => {
  const bare = makeItem({ id: 'cluster-tg-it_vakansii_udalenka-2838', title: 'CTO', company: '' });

  it('«О компании» не показывается без компании и без рекрутёра', async () => {
    const { CompanyBlock } = await import('../card/CompanyBlock');
    const html = renderToStaticMarkup(
      <CompanyBlock
        item={bare}
        recruiter={undefined}
        vacancyId={bare.cluster.id}
        companyPath={null}
        acquaintCount={0}
      />,
    );
    expect(html).toBe('');
  });

  it('с рекрутёром блок остаётся: «Откликнуться напрямую» есть и без компании', async () => {
    const { CompanyBlock } = await import('../card/CompanyBlock');
    const recruiter = { fullName: 'Ирина Смирнова', roleTitle: 'HR' } as never;
    const html = renderToStaticMarkup(
      <CompanyBlock
        item={bare}
        recruiter={recruiter}
        vacancyId={bare.cluster.id}
        companyPath={null}
        acquaintCount={0}
      />,
    );
    expect(html).toContain('О компании');
    expect(html).toContain('Откликнуться напрямую');
  });

  it('в «Письме и резюме» нет строки «Сайт компании», когда компании нет', async () => {
    const { resumeRows } = await import('../card/LetterBlock');
    const resume = { available: true, kind: 'master' as const };
    expect(resumeRows({ hasHh: false, hhTitle: null, resume, hasCompany: false })).toEqual([]);
    expect(
      resumeRows({ hasHh: false, hhTitle: null, resume, hasCompany: true }).map((row) => row.title),
    ).toEqual(['Сайт компании']);
  });
});
