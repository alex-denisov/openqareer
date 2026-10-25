import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DIALOGUE_ANSWERS,
  CURRENT_PATH,
  BASE_PATH,
  createRig,
  headersFor,
  mutationHeaders,
  runFrom,
  startRun,
  postDialogue,
  decideSuggestions,
} from './roleSkillAssessmentRouteTestRig';

describe('B564 profile suggestions survive an imprecise model answer', () => {
  function suggestion(statement: string, sourceExcerpt: string, sourceAnswerIndex: number) {
    return { domain: 'skill', statement, sourceExcerpt, sourceAnswerIndex };
  }

  async function answerDialogue(rig: Awaited<ReturnType<typeof createRig>>) {
    let run = await startRun(rig);
    for (const answer of DIALOGUE_ANSWERS) {
      const { response } = await postDialogue(rig, run, answer);
      if (response.statusCode !== 200) return { response, run };
      run = runFrom(response);
    }
    return { response: null, run };
  }

  it('keeps tolerant quotes, drops a made-up quote and a repeated statement', async () => {
    const suggestionJson = [
      '```json',
      JSON.stringify({
        suggestions: [
          suggestion('Проводит интервью с клиентами.', 'Провела 12 интервью', 0),
          // Spacing, the final period and typographic quotes differ from the answer.
          suggestion('Считает unit-экономику.', 'Проверила  unit-экономику сегмента.', 1),
          suggestion('Сравнивает с контрольной группой.', 'Сверила конверсию', 2),
          suggestion('Руководила отделом из 40 человек.', 'Руководила отделом из 40 человек', 0),
          suggestion('Проводит интервью  с клиентами', 'выделила три устойчивых сценария', 0),
        ],
      }),
      '```',
    ].join('\n');
    const rig = await createRig(8, false, { suggestionJson });
    const { response, run } = await answerDialogue(rig);

    expect(response).toBeNull();
    expect(run.status).toBe('suggestions');
    expect(run.suggestions.map((item) => item.statement)).toEqual([
      'Проводит интервью с клиентами.',
      'Считает unit-экономику.',
      'Сравнивает с контрольной группой.',
    ]);
    expect(run.suggestions[1]!.sourceExcerpt).toBe('Проверила unit-экономику сегмента');
  });

  it('reads the JSON a coach model wraps in prose (live nemotron answer, 25.10)', async () => {
    const json = JSON.stringify({
      suggestions: [suggestion('Проводит интервью с клиентами.', 'Провела 12 интервью', 0)],
    });
    const suggestionJson = `На основе трёх ответов сформировал предложения.\n\`\`\`json\n${json}\n\`\`\`\nПроверьте их.`;
    const rig = await createRig(8, false, { suggestionJson });
    const { run } = await answerDialogue(rig);

    expect(run.status).toBe('suggestions');
    expect(run.suggestions).toHaveLength(1);
  });

  it('asks for the suggestions as a structured step, not a coach reply', async () => {
    const rig = await createRig();
    await answerDialogue(rig);

    const [input] = rig.provider.createTurn.mock.calls[0]!;
    expect(input.internalPurpose).toBe('structured-stage');
  });

  it('takes the facts a coach model filed as memory candidates when message is prose', async () => {
    const memory = (ids: readonly string[]) =>
      [
        // Verbatim sentence of answer 0.
        [
          'responsibility',
          'Провела 12 интервью и выделила три устойчивых сценария для клиентов.',
          ids[0],
        ],
        // A retelling of answer 1: the answer sentence it rests on becomes the quote.
        ['skill', 'Проверяла unit-экономику сегмента перед решением.', ids[1]],
        // Not in the cited answer.
        ['outcome', 'Руководила отделом из 40 человек.', ids[2]],
        // Cites no dialogue answer.
        ['skill', 'Сверила конверсию с контрольной группой.', 'unknown-message'],
      ].map(([domain, statement, id]) => ({
        kind: 'fact' as const,
        domain: domain as 'skill',
        statement: statement!,
        confidence: 'candidate-confirmed' as const,
        sourceMessageIds: [id!],
        sensitive: false,
      }));
    const rig = await createRig(8, false, {
      suggestionJson: 'У вас сильный операционный профиль. Сформировал факты для профиля.',
      suggestionMemory: memory,
    });
    const { response, run } = await answerDialogue(rig);

    expect(response).toBeNull();
    expect(run.suggestions.map((item) => [item.statement, item.sourceExcerpt])).toEqual([
      [
        'Провела 12 интервью и выделила три устойчивых сценария для клиентов.',
        'Провела 12 интервью и выделила три устойчивых сценария для клиентов.',
      ],
      [
        'Проверяла unit-экономику сегмента перед решением.',
        'Проверила unit-экономику сегмента и согласовала измеримые критерии решения.',
      ],
    ]);
    expect(run.suggestions[1]!.sourceMessageId).toBe(run.dialogueEntries[1]!.id);
  });

  it('keeps the complete suggestions of an answer cut at the output limit', async () => {
    const full = JSON.stringify({
      suggestions: [
        suggestion('Проводит интервью с клиентами.', 'Провела 12 интервью', 0),
        suggestion('Считает unit-экономику.', 'Проверила unit-экономику', 1),
      ],
    });
    const rig = await createRig(8, false, { suggestionJson: full.slice(0, full.length - 30) });
    const { run } = await answerDialogue(rig);

    expect(run.status).toBe('suggestions');
    expect(run.suggestions).toHaveLength(1);
  });

  it('opens the cases without suggestions when no suggestion is valid', async () => {
    const suggestionJson = JSON.stringify({
      suggestions: [suggestion('Руководила отделом.', 'Руководила отделом из 40 человек', 0)],
    });
    const rig = await createRig(8, false, { suggestionJson });
    const { response, run } = await answerDialogue(rig);

    expect(response).toBeNull();
    expect(run.status).toBe('suggestions');
    expect(run.suggestions).toEqual([]);
    const decided = await decideSuggestions(rig, run, new Set());
    expect(decided.statusCode).toBe(200);
    expect(runFrom(decided).status).toBe('cases');
  });

  it('lets the candidate go on to the cases after the suggestion step failed', async () => {
    const rig = await createRig(8, true);
    const { response, run } = await answerDialogue(rig);
    expect(response?.statusCode).toBe(503);
    expect(run.status).toBe('dialogue');
    const current = await rig.app.inject({
      method: 'GET',
      url: CURRENT_PATH,
      headers: headersFor(rig.candidate),
    });
    const failed = runFrom(current);

    const skipped = await rig.app.inject({
      method: 'POST',
      url: `${BASE_PATH}/${failed.id}/suggestions`,
      headers: mutationHeaders(rig),
      payload: { expectedRevision: failed.revision, requestId: randomUUID(), suggestions: [] },
    });
    expect(skipped.statusCode).toBe(200);
    expect(runFrom(skipped).status).toBe('cases');
    expect(rig.provider.createTurn).toHaveBeenCalledTimes(1);
  });

  it('asks the model again under a new key when the step is retried', async () => {
    const rig = await createRig(8, true);
    await answerDialogue(rig);
    const current = await rig.app.inject({
      method: 'GET',
      url: CURRENT_PATH,
      headers: headersFor(rig.candidate),
    });
    const failed = runFrom(current);
    const retry = await rig.app.inject({
      method: 'POST',
      url: `${BASE_PATH}/${failed.id}/retry`,
      headers: mutationHeaders(rig),
      payload: { expectedRevision: failed.revision, requestId: randomUUID() },
    });

    expect(retry.statusCode).toBe(200);
    const keys = rig.provider.createTurn.mock.calls.map((call) => call[1]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('gives the grading model the exact answer shape it must return', async () => {
    const rig = await createRig();
    const { run } = await answerDialogue(rig);
    const decided = runFrom(await decideSuggestions(rig, run, new Set()));
    const record = decided.cases[0]!;
    await rig.app.inject({
      method: 'POST',
      url: `${BASE_PATH}/${decided.id}/cases/${record.assessmentCase.id}/answer`,
      headers: mutationHeaders(rig),
      payload: { expectedRevision: decided.revision, requestId: randomUUID(), answer: 'Ответ.' },
    });

    const [input] = rig.provider.createTurn.mock.calls.at(-1)!;
    const context = JSON.parse(input.stageContext ?? '{}') as Record<string, unknown>;
    expect(input.internalPurpose).toBe('structured-stage');
    expect(JSON.stringify(context.outputSchema)).toContain('"criterionId":"context"');
    expect(JSON.stringify(context.outputSchema)).toContain('candidateExcerpt');
  });
});
