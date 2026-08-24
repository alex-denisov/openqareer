import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileReviewQueue } from './CareerProfileSurface';
import { reviewMemories } from '../coach/coachApi';

/**
 * The candidate was told "32 подтверждено" without having confirmed anything.
 * Now an import states facts as awaiting review, so the queue has to be able
 * to carry a whole import: every fact visible, one decision available (B166).
 */

function facts(count: number) {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `imp-fact-${index + 1}`,
    kind: 'fact' as const,
    domain: 'outcome' as const,
    statement: `Факт номер ${index + 1}`,
    confidence: 'candidate-reported' as const,
    sourceMessageIds: ['msg-1'],
    sensitive: false,
    status: 'proposed' as const,
    createdAt: '2026-08-24T12:00:00.000Z',
    updatedAt: '2026-08-24T12:00:00.000Z',
  }));
}

function renderQueue(count: number) {
  return renderToStaticMarkup(
    <ProfileReviewQueue
      proposedFacts={facts(count)}
      openQuestions={[]}
      onReview={async () => undefined}
      onReviewAll={async () => undefined}
    />,
  );
}

describe('fact review queue', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows every imported fact awaiting review, not only the first few', () => {
    const html = renderQueue(12);

    expect(html).toContain('Факт номер 1');
    expect(html).toContain('Факт номер 12');
  });

  it('offers one decision for the whole batch', () => {
    expect(renderQueue(12)).toContain('Подтвердить все — 12 фактов');
  });

  it('does not offer a batch decision for a single fact', () => {
    expect(renderQueue(1)).not.toContain('Подтвердить все');
  });

  it('sends the batch as one request instead of one request per fact', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { reviewed: 3, action: 'confirm' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reviewed = await reviewMemories(['a-1', 'a-2', 'a-3'], 'confirm');

    expect(reviewed).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/candidate/memory/review',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'confirm', memoryIds: ['a-1', 'a-2', 'a-3'] }),
      }),
    );
  });
});
