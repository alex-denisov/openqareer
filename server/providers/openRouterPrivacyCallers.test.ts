import { describe, expect, it } from 'vitest';
import { LlmCoverLetterWriter } from './coverLetterWriter';
import { LlmLinkedinDraftWriter } from './linkedinDraftWriter';
import { LlmResumeStructurer } from './resumeStructurer';
import { LlmRoleNamer } from './roleNamer';

const OPENROUTER = 'https://openrouter.ai/api/v1';

/** A fake chat client that records every request body and answers nothing useful. */
function recordingClient() {
  const bodies: Record<string, unknown>[] = [];
  const client = {
    chat: {
      completions: {
        create: async (body: Record<string, unknown>) => {
          bodies.push(body);
          return { choices: [{ message: { content: '{}' } }] };
        },
      },
    },
  };
  return { client, bodies };
}

const callers = (model: string, client: ReturnType<typeof recordingClient>['client']) => [
  () =>
    new LlmCoverLetterWriter({
      apiKey: 'k',
      model,
      provider: 'openrouter',
      baseUrl: OPENROUTER,
      client: client as never,
    })
      .writeCoverLetter({
        facts: [{ ref: 'memory:1', statement: 'Вёл команду.' }],
        vacancy: { title: 'Head of Engineering', requirements: [] },
        language: 'ru',
        tone: 'executive',
      } as never)
      .catch(() => undefined),
  () =>
    new LlmRoleNamer({ apiKey: 'k', model, baseUrl: OPENROUTER, client: client as never })
      .nameRoles([{ ref: 'memory:1', statement: 'Вёл команду разработки.' }], 'ru')
      .catch(() => undefined),
  () =>
    new LlmResumeStructurer({ apiKey: 'k', model, baseUrl: OPENROUTER, client: client as never })
      .structure('Иван Петров, руководитель разработки, 10 лет опыта в финтехе.')
      .catch(() => undefined),
  () =>
    new LlmLinkedinDraftWriter({
      apiKey: 'k',
      model,
      provider: 'openrouter',
      baseUrl: OPENROUTER,
      client: client as never,
    })
      .writeDraft({
        kind: 'post',
        topic: 'Как я строил команду',
        profileHeadline: 'Руководитель разработки',
        facts: [{ ref: 'memory:1', statement: 'Вёл команду.' }],
      })
      .catch(() => undefined),
];

describe('candidate data to OpenRouter outside the consultant (28.10)', () => {
  it('asks providers not to collect it: letters, role names, resume parsing, LinkedIn drafts', async () => {
    const { client, bodies } = recordingClient();
    for (const call of callers('deepseek/deepseek-v4.1-flash', client)) await call();
    expect(bodies).toHaveLength(4);
    for (const body of bodies) {
      expect(body.provider).toMatchObject({ data_collection: 'deny' });
    }
  });

  it('never sends it to a free model or pool', async () => {
    const { client, bodies } = recordingClient();
    for (const call of callers('openrouter/free', client)) await call();
    expect(bodies).toHaveLength(0);
  });
});
