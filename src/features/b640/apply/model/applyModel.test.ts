import { describe, expect, it } from 'vitest';
import type { ConnectionCircleResult } from '../../../vacancies/vacancyLetterApi';
import { application } from '../../responses/model/testApplication';
import {
  buildHead,
  paragraphs,
  parseStep,
  recipientOptions,
  resolveTarget,
  stepsFor,
} from './applyModel';

describe('B657: шаг отклика из адреса', () => {
  it('по умолчанию письмо, чужое значение не принимается', () => {
    expect(parseStep('')).toBe('letter');
    expect(parseStep('?step=send')).toBe('send');
    expect(parseStep('?step=resume')).toBe('resume');
    expect(parseStep('?step=anything')).toBe('letter');
    expect(parseStep('?step=form')).toBe('form');
    expect(stepsFor(false).map((step) => step.id)).toEqual(['resume', 'letter', 'send']);
    expect(stepsFor(true).map((step) => step.id)).toEqual(['resume', 'letter', 'form', 'send']);
  });
});

describe('B657: что открыто — отклик или вакансия', () => {
  const card = application({ id: 'app-1', clusterId: 'cluster-9' });

  it('id отклика даёт его вакансию', () => {
    expect(resolveTarget('app-1', [card])).toEqual({ vacancyId: 'cluster-9', application: card });
  });

  it('id вакансии находит уже существующий отклик', () => {
    expect(resolveTarget('cluster-9', [card])).toEqual({ vacancyId: 'cluster-9', application: card });
  });

  it('id вакансии без карточки отклика тоже принимается', () => {
    expect(resolveTarget('cluster-new', [card])).toEqual({ vacancyId: 'cluster-new', application: null });
  });

  it('отклик без вакансии из подбора письма не получает', () => {
    expect(resolveTarget('manual', [application({ id: 'manual', clusterId: null })])).toBeNull();
  });
});

describe('B657: шапка отклика', () => {
  it('берёт данные карточки отклика', () => {
    expect(buildHead({ application: application() })).toEqual({
      title: 'Руководитель платформы',
      company: 'Арка Холдинг',
      url: 'https://hh.ru/vacancy/1',
      source: 'hh.ru',
      platform: { label: 'hh.ru', site: false },
    });
  });

  it('без карточки — из подбора и ответа сервера, небезопасный адрес отбрасывается', () => {
    expect(
      buildHead({
        application: null,
        known: { vacancyTitle: 'Head of Engineering', companyName: 'Гринкод' },
        cluster: {
          canonicalTitle: 'x',
          canonicalCompany: 'y',
          primaryUrl: 'javascript:alert(1)',
          sources: [{ sourceName: 'hh.ru (страница поиска)' }],
        },
      }),
    ).toEqual({
      title: 'Head of Engineering',
      company: 'Гринкод',
      url: null,
      source: 'hh.ru',
      platform: { label: 'hh.ru', site: false },
    });
  });

  it('скрытая компания не подставляется', () => {
    const hidden = application({
      vacancy: { title: 'Аналитик', company: 'Тайна', url: '', source: 'manual', companyHidden: true },
    });
    expect(buildHead({ application: hidden }).company).toBe('');
  });
});

describe('B657: «Кому»', () => {
  const person = (id: string, fullName: string) => ({ id, fullName, roleTitle: null, companyName: null });
  const circles: ConnectionCircleResult[] = [
    {
      circle: 1,
      state: 'available',
      message: '',
      paths: [
        {
          id: 'p1', circle: 1, path: [person('me', 'Марина Соколова'), person('a', 'Анна Ветрова')], recipient: person('a', 'Анна Ветрова'),
          evidence: [], strength: 'direct', source: 'manual', nextStep: 'write' as never,
        },
      ],
    },
    {
      circle: 2,
      state: 'available',
      message: '',
      paths: [
        {
          id: 'p2', circle: 2, path: [person('me', 'Марина Соколова'), person('i', 'Игорь Шаталов'), person('a', 'Анна Ветрова')],
          recipient: person('a', 'Анна Ветрова'), evidence: [], strength: 'weak', source: 'linkedin_import',
          nextStep: 'ask' as never,
        },
      ],
    },
    { circle: 3, state: 'available', message: '', paths: [] },
  ];

  it('первым идёт работодатель, дальше пути через знакомых', () => {
    expect(recipientOptions(circles, 'hh.ru')).toEqual([
      { value: 'cold', label: 'Работодателю · через hh.ru', circle: 3, pathId: null },
      { value: 'p1', label: 'Анна Ветрова · знакомый', circle: 1, pathId: 'p1' },
      { value: 'p2', label: 'Игорь Шаталов — попросить познакомить: Анна Ветрова', circle: 2, pathId: 'p2' },
    ]);
  });

  it('без знакомых остаётся один адресат', () => {
    expect(recipientOptions([], null)).toEqual([
      { value: 'cold', label: 'Работодателю', circle: 3, pathId: null },
    ]);
  });
});

describe('B657: текст абзацами', () => {
  it('убирает пустые строки', () => {
    expect(paragraphs('Здравствуйте!\n\n  Пять лет…  \n\nМарина')).toEqual([
      'Здравствуйте!',
      'Пять лет…',
      'Марина',
    ]);
  });
});
