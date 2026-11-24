// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationQuestionnaire } from '../../../../shared/applicationQuestionnaire';
import { click, mount, type Mounted } from '../kit/testDom';
import { FormStep, type QuestionnaireState } from './FormStep';
import { useVisibilityQuestion } from './visibilityQuestion';

vi.mock('../../../services/desktop/desktopBridge', async (original) => ({
  ...(await original<object>()),
  isTauriEnvironment: () => true,
}));

const form = {
  questions: [{ id: 'q1', text: 'Почему мы?', required: true, kind: 'text' }],
  suggestions: [],
  formUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=1',
} as unknown as ApplicationQuestionnaire;
const state = {
  form,
  draft: { q1: 'Потому' },
  submitted: { kind: 'idle' },
  saveError: null,
  save: vi.fn(),
  setAnswer: vi.fn(),
} as unknown as QuestionnaireState;
const onSend = vi.fn();
let view: Mounted | null = null;
afterEach(() => view?.unmount());

function Harness() {
  const visibility = useVisibilityQuestion();
  return (
    <>
      <button type="button" onClick={visibility.ask}>
        hh спросил
      </button>
      <FormStep state={state} form={form} visibility={visibility} onSend={onSend} />
    </>
  );
}

const named = (text: string) =>
  [...view!.container.querySelectorAll('button')].find((item) => item.textContent === text) as HTMLButtonElement;
const option = (text: string) =>
  [...view!.container.querySelectorAll('label.vt-opt')].find((item) => item.textContent === text)!.querySelector('input');

describe('B787: вопрос hh.ru о показе резюме в анкете', () => {
  it('появляется после вопроса hh.ru; без «Да» отклик не уходит', () => {
    view = mount(<Harness />);
    const send = () => named('Отправить отклик с анкетой');
    expect(view.container.textContent).not.toContain('покажет ваше резюме');
    expect(send().disabled).toBe(false);
    click(named('hh спросил'));
    expect(view.container.textContent).toContain('hh.ru покажет ваше резюме работодателям из другой страны. Разрешить?');
    expect(send().disabled).toBe(true);
    click(option('Нет'));
    expect(send().disabled).toBe(true);
    click(option('Да'));
    expect(send().disabled).toBe(false);
    click(send());
    expect(onSend).toHaveBeenCalledOnce();
  });
});
