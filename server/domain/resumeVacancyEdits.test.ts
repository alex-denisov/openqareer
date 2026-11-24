import { describe, expect, it } from 'vitest';
import { NO_EDIT_CHOICES } from '../../shared/resumeVacancyEdits';
import { buildTargetedResumeSlice } from './resumeStudioTargeted';
import type { TargetedResumeSlice } from './resumeStudioTypes';
import {
  editSource,
  keepsSourceNumbers,
  resumeVacancyEdits,
  tailorResumeSlice,
  withDecision,
} from './resumeVacancyEdits';

const bullet = (memoryId: string, value: string) => ({
  memoryId,
  value,
  sourceMessageIds: [],
  reviewFlags: [],
});
const slice = {
  requirements: [{ requirement: 'Kubernetes', matched: true }],
  document: {
    experience: [
      {
        id: 'e1',
        bullets: [
          bullet('a', 'Вела бэкенд'),
          bullet('b', 'Стек: Go'),
          bullet('c', 'Перевела платформу на Kubernetes, 2024'),
        ],
      },
      { id: 'e2', bullets: [bullet('d', 'Kubernetes с нуля'), bullet('f', 'Дежурства')] },
    ],
  },
} as unknown as TargetedResumeSlice;

const order = (value: TargetedResumeSlice) =>
  value.document.experience[0]!.bullets.map((item) => item.value);

describe('правки резюме под вакансию (B785)', () => {
  it('правка — только пункт, который поднялся; причина — требование вакансии', () => {
    expect(resumeVacancyEdits(slice, NO_EDIT_CHOICES)).toEqual([
      {
        id: 'e1:c',
        text: 'Перевела платформу на Kubernetes, 2024',
        why: 'Kubernetes',
        cancelled: false,
      },
    ]);
    expect(order(tailorResumeSlice(slice, NO_EDIT_CHOICES))).toEqual([
      'Перевела платформу на Kubernetes, 2024',
      'Вела бэкенд',
      'Стек: Go',
    ]);
  });

  it('отмена оставляет пункт на месте, возврат поднимает снова', () => {
    const cancelled = withDecision(NO_EDIT_CHOICES, { action: 'cancel', id: 'e1:c' }, 'x');
    expect(order(tailorResumeSlice(slice, cancelled))[2]).toContain('Kubernetes');
    expect(resumeVacancyEdits(slice, cancelled)[0]?.cancelled).toBe(true);
    expect(withDecision(cancelled, { action: 'restore', id: 'e1:c' }, 'x')).toEqual(
      NO_EDIT_CHOICES,
    );
  });

  it('изменённый текст встаёт в резюме; исходный текст снимает изменение', () => {
    const source = editSource(slice, 'e1:c')!;
    const changed = withDecision(
      NO_EDIT_CHOICES,
      { action: 'text', id: 'e1:c', text: 'Kubernetes в 2024' },
      source,
    );
    expect(order(tailorResumeSlice(slice, changed))[0]).toBe('Kubernetes в 2024');
    expect(withDecision(changed, { action: 'text', id: 'e1:c', text: source }, source)).toEqual(
      NO_EDIT_CHOICES,
    );
    expect(editSource(slice, 'e2:d')).toBeNull();
  });

  it('новых чисел в тексте быть не может', () => {
    expect(keepsSourceNumbers('Kubernetes, 2024', 'На Kubernetes в 2024')).toBe(true);
    expect(keepsSourceNumbers('Сократила на 30%', 'На Kubernetes в 2024')).toBe(false);
  });
});

describe('порядок мест и причина правки (B785)', () => {
  const place = (id: string, start: string | null, end: string | null, value: string) => ({
    id,
    title: bullet('t' + id, 'Роль'),
    employer: null,
    location: null,
    startDate: start ? bullet('s' + id, start) : null,
    endDate: end ? bullet('e' + id, end) : null,
    current: { ...bullet('c' + id, ''), value: !end && Boolean(start) },
    bullets: [bullet('o' + id, 'Вела группу'), bullet('b' + id, value)],
  });
  const master = {
    kind: 'master',
    contact: { fullName: 'A', email: null, phone: null, location: null, links: [] },
    experience: [
      place('vk', '2020-01', '2023', 'Сервис на Go'),
      place('none', null, null, 'Go'),
      place('opti', '2025-02', null, 'Запуск go-to-market (GTM)'),
      place('old', '2016', '2020-01', 'Отчёты'),
    ],
    education: [],
    languages: [],
    unknowns: [],
  } as unknown as Parameters<typeof buildTargetedResumeSlice>[0];
  const targeted = buildTargetedResumeSlice(master, { title: 'x', requirements: ['Go'] });

  it('места от последнего к раннему, без дат — внизу', () => {
    expect(targeted.document.experience.map((item) => item.id)).toEqual([
      'opti',
      'vk',
      'old',
      'none',
    ]);
  });

  it('go-to-market под «Go» не поднимается', () => {
    const edits = resumeVacancyEdits(targeted, NO_EDIT_CHOICES);
    expect(edits.map((item) => item.id)).toEqual(['vk:bvk', 'none:bnone']);
  });
});
