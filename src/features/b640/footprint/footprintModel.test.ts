import { describe, expect, it } from 'vitest';
import type { CandidateFootprintAudit } from '../../../../shared/candidateFootprint';
import type { FootprintRiskItem } from '../../../../shared/footprintRisk';
import {
  auditProgress,
  defaultSelection,
  failedChecks,
  findingsWord,
  letterText,
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
