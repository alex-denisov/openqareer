import { describe, expect, it, vi } from 'vitest';
import { LlmResumeStructurer, QueuedResumeStructurer, buildResumeStructurer } from './resumeStructurer';
import { HygienicResumeStructurer } from './hygienicResumeStructurer';

function clientReturning(content: string | null) {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content } }],
  });
  return { create, client: { chat: { completions: { create } } } } as const;
}

const validAnswer = JSON.stringify({
  fullName: 'Marina Orlova',
  targetRole: 'VP of Technology',
  about: null,
  contact: {
    email: 'a@example.com',
    phone: null,
    telegram: null,
    location: 'Dubai',
    links: [],
  },
  experience: [
    {
      title: 'VP of Technology',
      employer: 'Enterprise Energy IT Services',
      location: null,
      startDate: '2023-04',
      endDate: '2025-10',
      current: false,
      responsibilities: ['Rebuilt ITIL 4 processes'],
      achievements: ['Grew revenue 4x'],
    },
  ],
  skills: ['ITIL', 'DevOps'],
  education: [
    {
      institution: 'Universitatea Tehnică a Moldovei',
      qualification: 'BE, Information Technology',
      startDate: '2005',
      endDate: '2010',
    },
  ],
  courses: [],
  tests: [],
  recommendations: [],
  languages: [{ name: 'English', cefr: 'C1' }],
  additional: null,
});

const source = 'Marina Orlova\nVP of Technology\nEnterprise Energy IT Services 2023 - 2025';

describe('LlmResumeStructurer', () => {
  it('returns the structured resume the provider produced', async () => {
    const { client } = clientReturning(validAnswer);
    const structurer = new LlmResumeStructurer({
      apiKey: 'k',
      model: 'gpt-5.6-sol',
      client,
    });

    const parsed = await structurer.structure(source);

    expect(parsed?.fullName).toBe('Marina Orlova');
    expect(parsed?.experience).toHaveLength(1);
    expect(parsed?.experience[0].employer).toBe('Enterprise Energy IT Services');
    expect(parsed?.languages[0]).toEqual({ name: 'English', cefr: 'C1' });
    expect(parsed?.rawText).toBe(source);
  });

  it('reads an answer a provider wrapped in a code fence', async () => {
    const { client } = clientReturning(`Here you go:\n\`\`\`json\n${validAnswer}\n\`\`\``);
    const structurer = new LlmResumeStructurer({
      apiKey: 'k',
      model: 'gpt-5.6-sol',
      client,
    });

    expect((await structurer.structure(source))?.fullName).toBe('Marina Orlova');
  });

  it('gives up instead of inventing when the answer breaks the schema', async () => {
    const { client } = clientReturning('{"fullName": 42}');
    const structurer = new LlmResumeStructurer({
      apiKey: 'k',
      model: 'gpt-5.6-sol',
      client,
    });

    expect(await structurer.structure(source)).toBeNull();
  });

  it('gives up when the provider call fails', async () => {
    const create = vi.fn().mockRejectedValue(new Error('provider down'));
    const structurer = new LlmResumeStructurer({
      apiKey: 'k',
      model: 'gpt-5.6-sol',
      client: { chat: { completions: { create } } } as never,
    });

    expect(await structurer.structure(source)).toBeNull();
  });

  it('does not call the provider for text too short to be a resume', async () => {
    const { create, client } = clientReturning(validAnswer);
    const structurer = new LlmResumeStructurer({
      apiKey: 'k',
      model: 'gpt-5.6-sol',
      client,
    });

    expect(await structurer.structure('короткo')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('sends the document as data inside a delimiter', async () => {
    const { create, client } = clientReturning(validAnswer);
    const structurer = new LlmResumeStructurer({
      apiKey: 'k',
      model: 'gpt-5.6-sol',
      client,
    });

    await structurer.structure(source);

    const request = create.mock.calls[0][0];
    expect(request.messages[1].content).toContain('<resume-document>');
    expect(request.messages[0].content).toContain('untrusted data');
  });
});

describe('buildResumeStructurer', () => {
  it('stays undefined without a credential so the deterministic parser runs', () => {
    expect(buildResumeStructurer({ providerCredentials: {} })).toBeUndefined();
  });

  it('builds the paid chain luna → deepseek-v4.1-flash → glm-5.3-flash inside hygiene (28.10)', () => {
    // Собранный структуратор обязан быть в чистке: разобранное резюме кандидат
    // правит и уносит в отклики, и мимо чистки пути быть не должно (B210).
    const built = buildResumeStructurer({
      providerCredentials: { openai: 'sk-test-key', openrouter: 'sk-or-test-key' },
    });
    expect(built).toBeInstanceOf(HygienicResumeStructurer);
    const inner = (built as HygienicResumeStructurer).inner as QueuedResumeStructurer;
    expect(inner).toBeInstanceOf(QueuedResumeStructurer);
    expect(inner.stages.map((stage) => stage.provenance?.model)).toEqual([
      'gpt-5.6-luna',
      'deepseek/deepseek-v4.1-flash',
      'z-ai/glm-5.3-flash',
    ]);
  });
});

describe('QueuedResumeStructurer', () => {
  const stage = (model: string, answer: 'null' | 'throw' | 'ok') => ({
    provenance: { model, promptRevision: 'r1' },
    structure: vi.fn(async () => {
      if (answer === 'throw') throw new Error('503');
      return answer === 'ok' ? ({ fullName: model } as never) : null;
    }),
  });

  it('moves to the next stage on silence or failure and names the one that answered', async () => {
    const stages = [stage('a', 'throw'), stage('b', 'null'), stage('c', 'ok')];
    const queued = new QueuedResumeStructurer(stages);
    expect(await queued.structure('resume text')).toEqual({ fullName: 'c' });
    expect(queued.provenance?.model).toBe('c');
    for (const item of stages) expect(item.structure).toHaveBeenCalledTimes(1);
  });

  it('stops at the first answer', async () => {
    const stages = [stage('a', 'ok'), stage('b', 'ok')];
    await new QueuedResumeStructurer(stages).structure('resume text');
    expect(stages[1].structure).not.toHaveBeenCalled();
  });

  it('returns null when every stage is silent, so the rules parser runs', async () => {
    expect(await new QueuedResumeStructurer([stage('a', 'null'), stage('b', 'throw')]).structure('x')).toBeNull();
  });
});
