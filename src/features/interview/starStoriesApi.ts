import { apiFetch, readDataObject } from '../coach/apiClient';
import type {
  StarStoriesSnapshot,
  StarStoryView,
  StarStoryWriteInput,
} from '../../../shared/starStories';

const STAR_STORIES_URL = '/api/v1/candidate/star-stories';

export async function getStarStories(signal?: AbortSignal): Promise<StarStoriesSnapshot> {
  const response = await apiFetch(STAR_STORIES_URL, { signal });
  return readDataObject<StarStoriesSnapshot>(response);
}

export async function createStarStory(input: StarStoryWriteInput): Promise<StarStoryView> {
  return mutateStarStory(STAR_STORIES_URL, 'POST', input);
}

export async function updateStarStory(
  id: string,
  expectedVersion: number,
  input: StarStoryWriteInput,
): Promise<StarStoryView> {
  return mutateStarStory(`${STAR_STORIES_URL}/${encodeURIComponent(id)}`, 'PATCH', {
    ...input,
    expectedVersion,
  });
}

async function mutateStarStory(
  url: string,
  method: 'POST' | 'PATCH',
  body: unknown,
): Promise<StarStoryView> {
  const response = await apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readDataObject<StarStoryView>(response);
}
