// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LetterScreenState } from '../../vacancies/vacancyLetterController';
import { mount, type Mounted } from '../kit/testDom';
import type { ApplyHead } from './model/applyModel';
import type { LetterVariantsState } from './useLetterVariants';

const { LetterStep } = await import('./LetterStep');

const head = { title: 'Директор по данным', company: 'Ромашка', url: 'https://hh.ru/vacancy/1', source: 'hh' } as unknown as ApplyHead;
const SAVED = { applicationId: 'app-1', documentId: 'doc-1', approvedAt: '2026-11-19T01:00:00.000Z', status: 'approved', sent: false };

function letterOf(failure: { readonly circles?: string; readonly draft?: string }): LetterScreenState {
  return {
    circles: { data: null, loading: false, error: failure.circles ?? '', retry: vi.fn() },
    circle: { circle: 3, selectedPathId: null, setCircle: vi.fn(), setSelectedPathId: vi.fn() },
    tone: 'executive',
    language: 'auto',
    setTone: vi.fn(),
    setLanguage: vi.fn(),
    draft: { pitch: null, workplaces: [], text: 'Одобренный текст письма.', setText: vi.fn(), loading: false, error: failure.draft ?? '', retry: vi.fn() },
    approval: { saved: SAVED, busy: false, error: '', approve: vi.fn(), reset: vi.fn(), resumeFailure: null, prepareResume: vi.fn(), attachGeneralResume: vi.fn() },
  } as unknown as LetterScreenState;
}

const variants = { total: 1, index: 0, selected: null, selectedId: null, locked: true } as unknown as LetterVariantsState;

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

describe('B716: одобренное письмо открывается своим текстом', () => {
  it.each([
    ['письмо не пересобралось', { draft: 'Лимит писем исчерпан' }],
    ['круги связей не загрузились', { circles: 'Сеть недоступна' }],
  ])('%s — показан одобренный текст, а не «Письмо не собралось»', (_name, failure) => {
    view = mount(<LetterStep letter={letterOf(failure)} variants={variants} head={head} onSend={vi.fn()} />);
    const text = view.container.textContent ?? '';
    expect(text).not.toContain('Письмо не собралось');
    expect(view.container.querySelector<HTMLTextAreaElement>('textarea.ap-letter')?.value).toBe('Одобренный текст письма.');
    expect(text).toContain('К отправке');
  });
});
