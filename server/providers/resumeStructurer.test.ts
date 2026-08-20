import { describe, expect, it, vi } from 'vitest';
import { LlmResumeStructurer, buildResumeStructurer } from './resumeStructurer';

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
    expect(
      buildResumeStructurer({ personalProvider: 'openai', providerCredentials: {} }),
    ).toBeUndefined();
  });

  it('builds a structurer when the personal provider has a credential', () => {
    expect(
      buildResumeStructurer({
        personalProvider: 'openai',
        model: 'gpt-5.6-sol',
        providerCredentials: { openai: 'sk-test-key' },
      }),
    ).toBeInstanceOf(LlmResumeStructurer);
  });
});
