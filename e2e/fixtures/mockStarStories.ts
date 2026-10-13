import {
  missingStarResultNumbers,
  starResultHasNumbers,
  starStoryEvidenceStatus,
  type StarStoriesSnapshot,
  type StarStoryFactView,
  type StarStoryRecord,
  type StarStoryWriteInput,
} from '../../shared/starStories';

interface MockStarStoryResponse {
  readonly status?: number;
  readonly data?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

const facts: readonly StarStoryFactView[] = [
  {
    id: 'fact-release-cycle',
    statement: 'Сократил цикл релиза с 14 до 3 дней.',
    domain: 'outcome',
    createdAt: '2026-10-01T12:00:00.000Z',
  },
  {
    id: 'fact-team-scope',
    statement: 'Координировал команду из 8 инженеров.',
    domain: 'responsibility',
    createdAt: '2026-10-02T12:00:00.000Z',
  },
];

function view(story: StarStoryRecord): StarStoriesSnapshot['stories'][number] {
  const sourceFacts = facts.filter((fact) => story.sourceFactIds.includes(fact.id));
  return {
    ...story,
    confidence: starStoryEvidenceStatus(story.fields.result, story.sourceFactIds, sourceFacts),
    sourceFacts,
  };
}

function sourceError(): MockStarStoryResponse {
  return {
    status: 422,
    error: {
      code: 'star_story_result_needs_source',
      message: 'Числа в результате должны совпадать с выбранным подтверждённым фактом.',
    },
  };
}

export function createMockStarStoriesFixture() {
  let stories: StarStoryRecord[] = [];
  let nextId = 1;
  return {
    handle(
      path: string,
      method: string,
      body: Record<string, unknown>,
    ): MockStarStoryResponse | null {
      if (path === '/api/v1/candidate/star-stories' && method === 'GET') {
        return { data: { stories: stories.map(view), facts } satisfies StarStoriesSnapshot };
      }
      if (path === '/api/v1/candidate/star-stories' && method === 'POST') {
        return createStory(body, stories, facts, nextId++, (next) => (stories = next));
      }
      const match = path.match(/^\/api\/v1\/candidate\/star-stories\/([^/]+)$/u);
      if (match && method === 'PATCH')
        return updateStory(match[1]!, body, stories, facts, (next) => (stories = next));
      return null;
    },
  };
}

function createStory(
  body: Record<string, unknown>,
  stories: readonly StarStoryRecord[],
  availableFacts: readonly StarStoryFactView[],
  sequence: number,
  save: (next: StarStoryRecord[]) => void,
): MockStarStoryResponse {
  const input = body as unknown as StarStoryWriteInput;
  if (invalidSources(input, availableFacts)) return sourceError();
  const now = new Date().toISOString();
  const story: StarStoryRecord = {
    ...input,
    id: `story-${sequence}`,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  save([...stories, story]);
  return { status: 201, data: view(story) };
}

function updateStory(
  id: string,
  body: Record<string, unknown>,
  stories: readonly StarStoryRecord[],
  availableFacts: readonly StarStoryFactView[],
  save: (next: StarStoryRecord[]) => void,
): MockStarStoryResponse {
  const current = stories.find((story) => story.id === id);
  if (!current)
    return { status: 404, error: { code: 'star_story_not_found', message: 'История не найдена.' } };
  if (Number(body.expectedVersion) !== current.version) {
    return {
      status: 409,
      error: {
        code: 'star_story_version_conflict',
        message: `История изменилась: ${String(body.expectedVersion)} → ${current.version}.`,
      },
    };
  }
  const input = body as unknown as StarStoryWriteInput;
  if (invalidSources(input, availableFacts)) return sourceError();
  const updated = {
    ...current,
    ...input,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  };
  save(stories.map((story) => (story.id === id ? updated : story)));
  return { data: view(updated) };
}

function invalidSources(
  input: StarStoryWriteInput,
  availableFacts: readonly StarStoryFactView[],
): boolean {
  const factsById = new Map(availableFacts.map((fact) => [fact.id, fact]));
  const selected = input.sourceFactIds.map((id) => factsById.get(id));
  if (selected.some((fact) => !fact)) return true;
  return starResultHasNumbers(input.fields.result)
    ? missingStarResultNumbers(input.fields.result, selected as StarStoryFactView[]).length > 0
    : false;
}
