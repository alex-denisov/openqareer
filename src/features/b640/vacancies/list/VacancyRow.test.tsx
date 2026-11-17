// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { makeItem } from './fixtures';
import { VacancyRow, type VacancyRowProps } from './VacancyRow';

vi.mock('../../shell/ShellContext', () => ({
  useShell: () => ({ navigate: vi.fn() }),
}));

const noop = () => undefined;
const actions = { want: async () => undefined, hide: async () => undefined, applied: async () => undefined };

function html(props: Partial<VacancyRowProps> & Pick<VacancyRowProps, 'item'>): string {
  const full: VacancyRowProps = {
    env: { currency: 'RUB', noRole: false },
    wanted: false,
    open: false,
    menuView: null,
    menuActions: actions,
    onToggleOpen: noop,
    onToggleSaved: noop,
    onMenu: noop,
    onCloseMenu: noop,
    ...props,
  };
  return renderToStaticMarkup(
    <table>
      <tbody>
        <VacancyRow {...full} />
      </tbody>
    </table>,
  );
}

describe('строка таблицы по макету s07', () => {
  const item = makeItem({
    id: 'v1',
    title: 'Руководитель разработки',
    company: 'Ладога Банк',
    percent: 86,
    salary: { from: 480_000, to: 580_000, currency: 'RUR' },
  });

  it('классы и подписи макета', () => {
    const out = html({ item });
    expect(out).toContain('class="vt-row"');
    expect(out).toContain('class="vt-toggle"');
    expect(out).toContain('class="vt-co"');
    expect(out).toContain('fit vt-fit is-hi num');
    expect(out).toContain('совпадение, сильное');
    expect(out).toContain('va-b va-fav');
    expect(out).toContain('va-b va-no');
    expect(out).toContain('va-b va-more');
    expect(out).toContain('aria-label="Сохранить вакансию"');
    expect(out).toContain('/app/vacancies/companies/');
  });

  it('сохранена: звезда закрашена и нажата', () => {
    const out = html({ item, application: { stage: 'saved' } as never });
    expect(out).toContain('va-fav is-on');
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('Убрать из сохранённых');
  });

  it('метка «Откликнулся» и «Хочу в компанию»', () => {
    const out = html({ item, application: { stage: 'applied' } as never, wanted: true });
    expect(out).toContain('Вы откликнулись');
    expect(out).toContain('vg-want');
  });

  it('раскрытая строка: is-open и aria-controls', () => {
    const out = html({ item, open: true });
    expect(out).toContain('vt-row is-open');
    expect(out).toContain('aria-controls="vacancy-details-v1"');
  });

  it('процента нет: «считаем», «Добавить опыт», «Выберите роль»', () => {
    expect(html({ item: makeItem({ id: 'a' }) })).toContain('vt-counting');
    const noProfile = makeItem({ id: 'b', noProfile: true });
    expect(html({ item: noProfile })).toContain('Добавить опыт');
    expect(html({ item: noProfile, env: { currency: 'RUB', noRole: true } })).toContain('Выберите роль');
  });

  it('режим «Помочь выбрать»: флажок перед названием, причина после, aria-label', () => {
    const pick = { checked: true, reason: 'не та роль', onToggle: noop };
    const out = html({ item, pick });
    expect(out).toContain('vt-row is-pick');
    expect(out).toContain('class="vz-ck"');
    expect(out).toMatch(/<input[^>]*checked/u);
    expect(out).toContain('aria-label="Скрыть: Руководитель разработки, Ладога Банк"');
    expect(out).toContain('<span class="vz-why">не та роль</span>');
    expect(out.indexOf('vz-ck')).toBeLessThan(out.indexOf('vt-toggle'));
    expect(out.indexOf('vt-toggle')).toBeLessThan(out.indexOf('vz-why'));
  });

  it('снятый флажок: причина остаётся, подсветки строки нет', () => {
    const out = html({ item, pick: { checked: false, reason: 'зарплата ниже', onToggle: noop } });
    expect(out).not.toContain('is-pick');
    expect(out).not.toMatch(/<input[^>]*checked/u);
    expect(out).toContain('зарплата ниже');
  });

  it('без режима флажка и причины нет', () => {
    const out = html({ item });
    expect(out).not.toContain('vz-ck');
    expect(out).not.toContain('vz-why');
  });
});
