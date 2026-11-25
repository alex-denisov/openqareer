import { beforeEach, describe, expect, it, vi } from 'vitest';
import { carryAnswers } from '../domain/applicationQuestionnaire';
import { boardFormRef, readBoardFormQuestions, resetBoardFormCache } from './boardFormReader';

beforeEach(() => resetBoardFormCache());

const recruitee = { board: 'recruitee', host: 'acme.recruitee.com', job: 'cto' } as const;
const teamtailor = { board: 'teamtailor', host: 'acme.teamtailor.com', job: '77' } as const;
const answering = (body: string) => vi.fn(async () => new Response(body));
const name = (index: number, field: string) =>
  `name="candidate[answers_attributes][${index}][${field}]"`;
const start = (index: number, id: number) =>
  `<input type="hidden" value="${id}" ${name(index, 'question_id')} id="x" />`;
const job = (id: string) =>
  `<input type="hidden" value="${id}" name="candidate[job_applications_attributes][0][job_id]" />`;
const PAGE = `
  ${start(0, 501)}<fieldset><legend><span>French &amp; English?<sup aria-hidden="true">*</sup><span>Required</span></span></legend>
  <input type="radio" value="true" ${name(0, 'boolean')} /><label for="a"> Yes </label>
  <input type="radio" value="false" ${name(0, 'boolean')} /><label for="b"> No </label></fieldset>
  ${start(1, 502)}<label for="c">Why us?</label><textarea ${name(1, 'text')}></textarea>
  ${start(2, 503)}<label for="v">Video</label><input ${name(2, 'picked_video_attributes')} />
  ${start(3, 504)}<fieldset><legend><span>Languages</span></legend>
  <button role="menuitemcheckbox"><span data-label-value="Spanish"> Spanish </span></button>
  <button role="menuitemcheckbox"><span data-label-value="Dutch"> Dutch </span></button>
  <input type="hidden" ${name(3, 'choices')} /></fieldset>
  <label for="consent">Privacy</label>${job('77')}`;

describe('B787: адрес формы', () => {
  it('узнаёт вакансию', () => {
    expect(boardFormRef('https://acme.recruitee.com/en/o/cto?a=1')).toEqual(recruitee);
    expect(boardFormRef('https://acme.recruitee.com/o/cto/c/new')).toEqual(recruitee);
    expect(boardFormRef('https://acme.teamtailor.com/jobs/77-dev')).toEqual(teamtailor);
  });

  it.each([
    'http://acme.recruitee.com/o/cto',
    'https://acme.recruitee.com.evil.example/o/cto',
    'https://evilrecruitee.com/o/cto',
    'https://user:p@acme.recruitee.com/o/cto',
    'https://acme.recruitee.com:8443/o/cto',
    'https://acme.recruitee.com/o/..%2Fx',
    'https://acme.teamtailor.com/jobs/abc',
    'не адрес',
  ])('не читает %s', (url) => {
    expect(boardFormRef(url)).toBeNull();
  });
});

describe('B787: вопросы Recruitee', () => {
  const question = (id: number, kind: string, more = {}) => ({
    id,
    kind,
    body: `Вопрос ${id}`,
    required: true,
    open_question_options: [],
    ...more,
  });

  it('читает виды вопросов и место работы', async () => {
    const offer = {
      slug: 'cto',
      open_questions: [
        question(1, 'salary'),
        question(2, 'boolean', { body: 'Live in <b>Poland</b>?' }),
        question(3, 'multi_choice', {
          open_question_options: [{ body: 'A &amp; B' }, { body: 'C' }],
        }),
        question(4, 'video'),
        { id: 'x' },
      ],
      location_question_visible: true,
      locations_question: 'Where?',
      locations_question_required: true,
      locations_question_type: 'single_choice',
      locations: [{ name: 'Warsaw' }],
    };
    const fetchImpl = answering(JSON.stringify({ offer }));
    expect(await readBoardFormQuestions(recruitee, fetchImpl as never)).toEqual([
      { id: 'recruitee_1', text: 'Вопрос 1', required: true, kind: 'text' },
      {
        id: 'recruitee_2',
        text: 'Live in Poland ?',
        required: true,
        kind: 'choice',
        options: ['Yes', 'No'],
      },
      {
        id: 'recruitee_3',
        text: 'Вопрос 3',
        required: true,
        kind: 'choice',
        options: ['A & B', 'C'],
        multiple: true,
      },
      {
        id: 'recruitee_locations',
        text: 'Where?',
        required: true,
        kind: 'choice',
        options: ['Warsaw'],
      },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://acme.recruitee.com/api/offers/cto');
    expect(init.redirect).toBe('error');
  });

  it('другая вакансия и сбой не дают вопросов, сбой не повторяется сразу', async () => {
    const other = answering(JSON.stringify({ offer: { slug: 'cfo', open_questions: [] } }));
    expect(await readBoardFormQuestions(recruitee, other as never)).toBeNull();
    expect(await readBoardFormQuestions(recruitee, other as never)).toBeNull();
    expect(other).toHaveBeenCalledTimes(1);
  });
});

describe('B787: вопросы Teamtailor', () => {
  it('читает вопросы страницы; видео и согласие — не вопросы', async () => {
    expect(await readBoardFormQuestions(teamtailor, answering(PAGE) as never)).toEqual([
      {
        id: 'teamtailor_501',
        text: 'French & English?',
        required: true,
        kind: 'choice',
        options: ['Yes', 'No'],
      },
      { id: 'teamtailor_502', text: 'Why us?', required: false, kind: 'text' },
      {
        id: 'teamtailor_504',
        text: 'Languages',
        required: false,
        kind: 'choice',
        options: ['Spanish', 'Dutch'],
        multiple: true,
      },
    ]);
  });

  it('форма без вопросов — пустой список, страница другой вакансии — null', async () => {
    expect(await readBoardFormQuestions(teamtailor, answering(job('77')) as never)).toEqual([]);
    const other = { ...teamtailor, job: '78' };
    expect(await readBoardFormQuestions(other, answering(PAGE) as never)).toBeNull();
  });
});

describe('B787: ответы после чтения формы приложением', () => {
  const ask = (id: string, text: string) => ({ id, text, required: true, kind: 'text' as const });

  it('переходят на вопрос с тем же текстом, повтор текста не переносится', () => {
    const saved = [
      { questionId: 'a', text: '5' },
      { questionId: 'b', text: 'да' },
    ];
    const from = [ask('a', 'Years?'), ask('b', 'Same')];
    const to = [ask('x', 'years? *'), ask('y', 'Same'), ask('z', 'Same')];
    expect(carryAnswers(from, to, saved)).toEqual([...saved, { questionId: 'x', text: '5' }]);
  });
});
