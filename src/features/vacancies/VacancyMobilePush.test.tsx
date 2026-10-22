// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { VacancyMobilePush, type VacancyMobilePushProps } from './VacancyMobilePush';
import * as api from './vacancyLetterApi';
import * as pitchApi from './vacancyPitchApi';
import * as recruiterApi from './recruiterContactsApi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = {
  cluster: {
    id: 'v1',
    canonicalTitle: 'Head of Engineering',
    canonicalCompany: 'Вектор Банк',
    canonicalLocation: 'Москва',
    isRemote: false,
    salary: null,
    descriptionSummary: 'Команда платежей.',
    skills: [],
    primaryUrl: 'https://hh.ru/vacancy/1',
    sources: [],
    firstObservedAt: '2026-10-05T08:00:00.000Z',
    lastSeenAt: '2026-10-05T08:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
  },
  explanation: {
    clusterId: 'v1',
    roleMatch: 'target',
    levelMatch: 'match',
    outsideGeography: false,
    matchingPoints: [],
    missingPoints: [],
    summary: '',
    calculatedAt: '2026-10-05T08:00:00.000Z',
  },
} as unknown as MatchedVacancyItem;

const circles: api.VacancyConnectionCircles = {
  vacancyId: 'v1',
  companyKey: 'vector',
  companyName: 'Вектор Банк',
  vacancyTitle: 'Head of Engineering',
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
          recipient: {
            id: 'a',
            fullName: 'Ирина Захарова',
            roleTitle: 'Director',
            companyName: null,
          },
          evidence: ['Работали вместе'],
          strength: 'direct',
          source: 'work_history',
          nextStep: 'write_known_contact',
        },
      ],
    },
    { circle: 2, state: 'none', message: '', paths: [] },
    { circle: 3, state: 'available', message: '', paths: [] },
  ],
  linkedinImport: { state: 'imported', importedAt: '2026-09-12T10:00:00.000Z', importedCount: 412 },
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function button(name: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll('button')).find((el) =>
    (el.getAttribute('aria-label') ?? el.textContent ?? '').includes(name),
  );
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

async function click(name: string) {
  await act(async () => button(name).click());
}

describe('VacancyMobilePush (B549)', () => {
  it('walks job → path → circle 1 and back, and closes from the job', async () => {
    vi.spyOn(api, 'getVacancyConnectionCircles').mockResolvedValue(circles);
    const onClose = vi.fn();
    const onWriteContact = vi.fn();
    const onEditContactDraft = vi.fn();
    const message = 'Ирина, добрый день! Увидел вакансию Head of Engineering.';
    vi.spyOn(recruiterApi, 'getRecruiterContacts').mockResolvedValue({
      contacts: [
        {
          id: 'r1',
          fullName: 'Мария Синтетова',
          roleTitle: 'IT Recruiter',
          companyName: 'Вектор Банк',
        },
      ] as never,
      job: null,
    });
    vi.spyOn(pitchApi, 'requestVacancyPitch').mockResolvedValue({
      vacancyId: 'v1',
      emailPitch: { subject: 'Head of Engineering', body: message },
      linkedInNote: message,
      atsCoverLetter: message,
      contactMessage: message,
      usedEvidenceIds: [],
      generatedAt: '2026-10-05T08:00:00.000Z',
    });
    const props: VacancyMobilePushProps = {
      item,
      onClose,
      onOpenFullDescription: vi.fn(),
      onApply: vi.fn(),
      applyLabel: 'Откликнуться',
      applyDisabled: false,
      pathActions: { onWriteContact, onEditContactDraft },
    };
    const host = document.createElement('div');
    document.body.append(host);
    await act(async () => createRoot(host).render(<VacancyMobilePush {...props} />));
    await act(async () => {});
    const title = () => document.querySelector('#vacancy-push-title')?.textContent;
    expect(title()).toBe('Вакансия');
    expect(document.body.textContent).toContain('Совпадение с вашими условиями');
    expect(document.body.textContent).toContain('1 контакт в компании');
    await click('Путь к компании');
    expect(title()).toBe('Путь к компании');
    expect(document.body.textContent).toContain('Вектор Банк · три круга связей');
    await click('Знакомый в компании');
    expect(title()).toBe('Круг 1');
    expect(document.body.textContent).toContain('Ирина Захарова');
    // G5 R3: круг 1 по макету — черновик от консультанта, одобрение и карандаш, без отправки.
    await act(async () => {});
    expect(document.body.textContent).toContain('Черновик сообщения · Ирина Захарова');
    expect(document.body.textContent).toContain('РекрутерМария СинтетоваIT Recruiter, Вектор Банк');
    expect(document.body.textContent).toContain(message);
    expect(document.body.textContent).toContain('Ничего не отправится без вашего одобрения.');
    expect(button('Одобрить и отправить').disabled).toBe(false);
    await click('Править');
    expect(onEditContactDraft).toHaveBeenCalledTimes(1);
    await click('Назад');
    expect(title()).toBe('Путь к компании');
    await click('Назад');
    expect(title()).toBe('Вакансия');
    await click('Назад');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
