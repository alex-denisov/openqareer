import { describe, expect, it } from 'vitest';
import type { CandidateFootprintAudit } from '../../../../shared/candidateFootprint';
import type { FootprintRiskItem } from '../../../../shared/footprintRisk';
import {
  auditProgress,
  confirmsOwner,
  defaultSelection,
  failedChecks,
  findingsWord,
  firstToRemove,
  letterText,
  riskLine,
  mailtoHref,
  opensRemovalPath,
  planGroups,
  searchByLine,
  selectedIds,
  type PlanItem,
} from './footprintModel';

const plan: PlanItem[] = [
  { id: 'a', kind: 'name', preview: 'Имя', selectedByDefault: true, available: true },
  { id: 'b', kind: 'username', preview: 'Ник msok', selectedByDefault: true, available: true },
  { id: 'c', kind: 'username', preview: 'Ник msok', selectedByDefault: true, available: true },
  { id: 'd', kind: 'profile_url', preview: 'Ссылка 1', selectedByDefault: true, available: true },
  { id: 'e', kind: 'profile_url', preview: 'Ссылка 2', selectedByDefault: false, available: true },
  { id: 'f', kind: 'email', preview: 'Почта', selectedByDefault: true, available: false },
];

function audit(state: CandidateFootprintAudit['state'], states: string[]): CandidateFootprintAudit {
  return {
    id: 'x', candidateId: 'c', state, selectedQueryIds: [], findings: [],
    ownershipConfirmedAt: '', startedAt: '',
    adapterStatuses: states.map((s) => ({ adapterId: 'exa', state: s, sourcesChecked: 0, findingsCount: 0 })),
  } as CandidateFootprintAudit;
}

const item: FootprintRiskItem = {
  id: 'f1', category: 'personal_data', level: 'high', levelLabel: 'высокий риск',
  title: 'Телефон в объявлении', detail: 'Доска объявлений', url: 'https://board.example/1',
  observedAt: null, resolved: false, action: { kind: 'close_account', label: 'Закрыть аккаунты' },
  findingId: 'f1', mismatch: null,
};

describe('план поиска', () => {
  it('сливает одинаковые запросы к разным источникам и прячет недоступные', () => {
    const groups = planGroups(plan);
    expect(groups.map((g) => g.label)).toEqual(['Имя', 'Ник msok', 'Ссылка 1', 'Ссылка 2']);
    expect(groups[1].ids).toEqual(['b', 'c']);
  });

  it('по умолчанию отмечено то, что сервер выбрал; строка «Ищем по» считает ссылки', () => {
    const groups = planGroups(plan);
    const selected = defaultSelection(plan);
    expect(searchByLine(groups, selected)).toBe('имя, ник, ссылка');
    const all = new Set(groups.map((g) => g.key));
    expect(searchByLine(groups, all)).toBe('имя, ник, 2 ссылки');
    expect(selectedIds(groups, selected)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('ход поиска', () => {
  it('доля законченных проверок без незапущенных', () => {
    expect(auditProgress(audit('pending', ['checked', 'pending', 'not_run']))).toEqual({ done: 1, total: 2 });
    expect(auditProgress(null)).toEqual({ done: 0, total: 1 });
  });

  it('сбой считается только после поиска', () => {
    expect(failedChecks(audit('pending', ['source_error']))).toBe(0);
    expect(failedChecks(audit('completed', ['checked', 'source_error']))).toBe(1);
    expect(failedChecks(audit('failed', ['checked']))).toBe(1);
    expect(failedChecks(audit('completed', ['checked']))).toBe(0);
  });
});

describe('находки', () => {
  it('склоняет «находка»', () => {
    expect([1, 2, 5, 11, 21, 22, 112].map(findingsWord)).toEqual([
      '1 находка', '2 находки', '5 находок', '11 находок', '21 находка', '22 находки', '112 находок',
    ]);
  });

  it('путь удаления есть у рисковых, у полезных — нет', () => {
    expect(opensRemovalPath(item)).toBe(true);
    expect(opensRemovalPath({ ...item, action: { kind: 'add_to_profile', label: 'В профиль' } })).toBe(false);
    expect(opensRemovalPath({ ...item, action: null })).toBe(false);
    expect(opensRemovalPath({ ...item, action: { kind: 'not_mine', label: 'Это не моё' } })).toBe(false);
    // B382: страница по нику — «Проверить» ведёт на f03b, сама страница открывается там.
    const nick = { ...item, action: { kind: 'confirm_owner' as const, label: 'Проверить' } };
    expect(confirmsOwner(nick)).toBe(true);
    expect(opensRemovalPath(nick)).toBe(true);
    expect(confirmsOwner({ ...nick, url: null })).toBe(false);
    expect(confirmsOwner(item)).toBe(false);
  });

  it('письмо сайту: удалить данные или исправить расхождение', () => {
    expect(letterText(item)).toBe(
      'Здравствуйте. На странице https://board.example/1 опубликованы мои данные: ' +
        'телефон в объявлении. Прошу удалить их и ответить на это письмо.',
    );
    const mismatch = {
      ...item, url: null,
      mismatch: { field: 'Должность', profileValue: 'руководитель группы', foundValue: 'тимлид' },
    };
    expect(letterText(mismatch)).toContain('На вашем сайте указано: Должность — «тимлид»');
    expect(letterText(mismatch)).toContain('верно — «руководитель группы»');
    expect(mailtoHref(item)).toMatch(/^mailto:\?subject=%D0/u);
  });

  it('заголовок — только адрес сайта: в письме нет «мои данные: spark-interfax.ru»', () => {
    const site = { ...item, url: 'https://www.spark-interfax.ru/ooo-1', title: 'spark-interfax.ru' };
    expect(letterText(site)).toBe(
      'Здравствуйте. На странице https://www.spark-interfax.ru/ooo-1 опубликованы мои данные. ' +
        'Прошу удалить их и ответить на это письмо.',
    );
  });
});

describe('B668: ссылка YouTube в «Данных для поиска»', () => {
  it('архив и канал по одной ссылке — одна строка, выбор запускает оба', () => {
    const preview = 'Проверить архив публичной страницы https://www.youtube.com/@ada';
    const groups = planGroups([
      { id: 'w', kind: 'profile_url', preview, selectedByDefault: true, available: true },
      { id: 'y', kind: 'profile_url', preview, selectedByDefault: true, available: true },
    ]);
    expect(groups).toEqual([{ key: `profile_url\0${preview}`, kind: 'profile_url', label: preview, ids: ['w', 'y'] }]);
  });
});

describe('B645 f03b: строка «Риск» — уровень и почему', () => {
  const base = { level: 'high', levelLabel: 'высокий риск' } as const;
  it('уровень коротко и причина через двоеточие, как в макете', () => {
    expect(riskLine({ ...base, levelReason: 'номер находят по имени' })).toBe('высокий: номер находят по имени');
    expect(riskLine({ level: 'important', levelLabel: 'важно', levelReason: 'совпадение по имени не подтверждено' }))
      .toBe('важно: совпадение по имени не подтверждено');
  });
  it('без причины — прежняя подпись уровня', () => {
    expect(riskLine(base)).toBe('высокий риск');
  });
});

describe('B645 f03: главная кнопка — первая находка, которую стоит убрать', () => {
  const nick = { ...item, id: 'nick', action: { kind: 'confirm_owner' as const, label: 'Проверить' } };
  const check = { ...item, id: 'check', action: { kind: 'check_now' as const, label: 'Проверить' } };
  const hide = { ...item, id: 'hide', action: { kind: 'hide' as const, label: 'Скрыть' } };
  it('страницы «Проверить» пропускает', () => {
    expect(firstToRemove([nick, check, hide])?.id).toBe('hide');
  });
  it('убирать нечего — первая страница «Проверить»', () => {
    expect(firstToRemove([nick, check])?.id).toBe('nick');
  });
  it('полезные и разобранные не берёт', () => {
    const useful = { ...item, action: { kind: 'not_mine' as const, label: 'Это не моё' } };
    expect(firstToRemove([useful, { ...hide, action: null }])).toBeUndefined();
  });
});

describe('B668: формы слов в «Ищем по»', () => {
  it('1, 2, 5, 7 и 21', () => {
    const line = (count: number) => {
      const groups = Array.from({ length: count }, (_, index) => ({
        key: String(index),
        kind: 'work_context' as const,
        label: '',
        ids: [],
      }));
      return searchByLine(groups, new Set(groups.map((group) => group.key)));
    };
    expect([1, 2, 5, 7, 21].map(line)).toEqual([
      'место работы',
      '2 места работы',
      '5 мест работы',
      '7 мест работы',
      '21 место работы',
    ]);
  });
});
