// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../coach/apiClient';
import { CareerExpertPanel } from './CareerExpertPanel';
import {
  LETTER_OBJECT_INTRO,
  VACANCY_OBJECT_INTRO,
  applicationScreenObject,
  letterScreenObject,
  screenTurnFor,
  sendScreenAwareTurn,
  vacancyScreenObject,
} from './consultantScreenObjects';
import {
  ConsultantTopicProvider,
  useConsultantLetterDraft,
  useConsultantScreenObject,
  usePublishConsultantLetterDraft,
  usePublishConsultantObject,
} from './consultantScreenTopic';
import { visibleContextLine } from './expertSheetView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<() => void> = [];
afterEach(() => {
  mounted.splice(0).forEach((unmount) => unmount());
});

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  mounted.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return { host, rerender: (next: React.ReactNode) => act(() => root.render(next)) };
}

const LETTER = letterScreenObject('cluster-1');
const ROW = vacancyScreenObject('cluster-2');

function Publisher({ object }: { readonly object: Parameters<typeof usePublishConsultantObject>[0] }) {
  usePublishConsultantObject(object);
  return null;
}

describe('консультант знает открытый на экране объект (B511 Д5)', () => {
  it('панель на письме не просит выбрать вакансию и говорит о письме', () => {
    const { host } = mount(
      <ConsultantTopicProvider>
        <Publisher object={LETTER} />
        <CareerExpertPanel stage="vacancies" initialUser={null} onClose={() => undefined} />
      </ConsultantTopicProvider>,
    );
    expect(host.textContent).toContain(LETTER_OBJECT_INTRO);
    expect(host.textContent).not.toContain('Выберите вакансию');
    expect(host.textContent).toContain('Видит: профиль, эту вакансию, письмо');
    expect(LETTER.placeholder).toBe('Что поправить в письме');
  });

  it('открытая строка вакансии меняет вступление; после закрытия — снова общее', () => {
    const panel = <CareerExpertPanel stage="vacancies" initialUser={null} onClose={() => undefined} />;
    const { host, rerender } = mount(
      <ConsultantTopicProvider>
        <Publisher object={ROW} />
        {panel}
      </ConsultantTopicProvider>,
    );
    expect(host.textContent).toContain(VACANCY_OBJECT_INTRO);
    expect(host.textContent).toContain('Видит: профиль, эту вакансию');
    rerender(
      <ConsultantTopicProvider>
        <Publisher object={null} />
        {panel}
      </ConsultantTopicProvider>,
    );
    expect(host.textContent).toContain('Выберите вакансию');
  });

  it('объект другого этапа панель не берёт', () => {
    let seen: unknown = 'unset';
    function Probe() {
      seen = useConsultantScreenObject('career');
      return null;
    }
    mount(
      <ConsultantTopicProvider>
        <Publisher object={ROW} />
        <Probe />
      </ConsultantTopicProvider>,
    );
    expect(seen).toBeNull();
  });

  it('снятие объекта чужим владельцем не сбрасывает текущий', () => {
    let seen: unknown;
    function Probe() {
      seen = useConsultantScreenObject('vacancies');
      return null;
    }
    const { rerender } = mount(
      <ConsultantTopicProvider>
        <Publisher key="a" object={ROW} />
        <Publisher key="b" object={LETTER} />
        <Probe />
      </ConsultantTopicProvider>,
    );
    expect(seen).toBe(LETTER);
    rerender(
      <ConsultantTopicProvider>
        <Publisher key="b" object={LETTER} />
        <Probe />
      </ConsultantTopicProvider>,
    );
    expect(seen).toBe(LETTER);
  });

  it('черновик письма читается в момент отправки и снимается вместе с экраном', () => {
    let read: () => string = () => 'unset';
    function Probe() {
      read = useConsultantLetterDraft();
      return null;
    }
    function Draft({ text }: { readonly text: string }) {
      usePublishConsultantLetterDraft(text);
      return null;
    }
    const { rerender } = mount(
      <ConsultantTopicProvider>
        <Draft text="Версия 1" />
        <Probe />
      </ConsultantTopicProvider>,
    );
    expect(read()).toBe('Версия 1');
    rerender(
      <ConsultantTopicProvider>
        <Draft text="Версия 2" />
        <Probe />
      </ConsultantTopicProvider>,
    );
    expect(read()).toBe('Версия 2');
    rerender(
      <ConsultantTopicProvider>
        <Probe />
      </ConsultantTopicProvider>,
    );
    expect(read()).toBe('');
  });
});

describe('какой объект уходит с ходом', () => {
  const discuss = { kind: 'vacancy', id: 'cluster-9' } as const;

  it('без объекта ход идёт, как раньше', () => {
    expect(screenTurnFor(undefined, null, '')).toEqual({ subject: undefined, fromScreen: false });
    expect(screenTurnFor(discuss, null, '')).toEqual({ subject: discuss, fromScreen: false });
  });

  it('открытая строка не перебивает явное «Обсудить»', () => {
    expect(screenTurnFor(discuss, ROW, '').subject).toBe(discuss);
    expect(screenTurnFor(undefined, ROW, '')).toEqual({ subject: ROW.subject, fromScreen: true });
  });

  it('письмо занимает экран: ход идёт о его вакансии с его текстом', () => {
    expect(screenTurnFor(discuss, LETTER, 'Текст')).toEqual({
      subject: LETTER.subject,
      fromScreen: true,
      screenDraft: 'Текст',
    });
    expect(screenTurnFor(undefined, LETTER, '  ').screenDraft).toBeUndefined();
  });

  it('длинный черновик обрезается до лимита запроса', () => {
    expect(screenTurnFor(undefined, LETTER, 'я'.repeat(9_000)).screenDraft).toHaveLength(8_000);
  });

  it('отклик уходит объектом отклика', () => {
    expect(applicationScreenObject('app-1').subject).toEqual({ kind: 'application', id: 'app-1' });
  });

  it('пропавшая вакансия не роняет ход: он повторяется без объекта экрана', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new CoachApiError('Объект не найден.', 'subject_not_found', false))
      .mockResolvedValueOnce({ message: 'Ответ' });
    const result = await sendScreenAwareTurn(send, { content: 'Вопрос' }, undefined, {
      subject: LETTER.subject,
      fromScreen: true,
      screenDraft: 'Текст',
    });
    expect(result).toEqual({ message: 'Ответ' });
    expect(send.mock.calls[0]?.[0]).toMatchObject({ subject: LETTER.subject, screenDraft: 'Текст' });
    expect(send.mock.calls[1]?.[0]).toEqual({ content: 'Вопрос', subject: undefined });
  });

  it('чужой объект и другая ошибка не повторяются', async () => {
    const error = new CoachApiError('Объект не найден.', 'subject_not_found', false);
    const send = vi.fn().mockRejectedValue(error);
    await expect(
      sendScreenAwareTurn(send, { content: 'Вопрос' }, discuss, { subject: discuss, fromScreen: false }),
    ).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('строка «Видит»', () => {
  it('называет письмо только когда оно уходит с ходом', () => {
    expect(visibleContextLine({ subjectKind: 'vacancy', hasMarketQuery: false, hasLetterDraft: true })).toBe(
      'Видит: профиль, эту вакансию, письмо',
    );
    expect(visibleContextLine({ subjectKind: 'vacancy', hasMarketQuery: false })).toBe(
      'Видит: профиль, эту вакансию',
    );
  });
});
