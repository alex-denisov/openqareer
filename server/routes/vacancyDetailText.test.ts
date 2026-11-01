import { describe, expect, it, vi } from 'vitest';
import { loadDetailText } from './vacancyDetailText';

describe('loadDetailText (02.11: card open reads text first, never waits behind warm-ups)', () => {
  it('returns the load when it answers in time', async () => {
    const engine = {
      loadVacancyDescription: vi.fn(async () => ({ unavailable: false, status: 'loaded' as const })),
      requestHhTextPriority: vi.fn(),
    };
    await expect(loadDetailText(engine, 'src-hh-search:1', 50)).resolves.toMatchObject({
      status: 'loaded',
    });
    expect(engine.requestHhTextPriority).not.toHaveBeenCalled();
  });

  it('a slow hh load puts the card at the head of the text queue and answers pending', async () => {
    const engine = {
      loadVacancyDescription: vi.fn(() => new Promise<never>(() => {})),
      requestHhTextPriority: vi.fn(),
    };
    await expect(loadDetailText(engine, 'src-hh-search:1', 10)).resolves.toEqual({
      unavailable: true,
      status: 'failed',
      pending: true,
    });
    expect(engine.requestHhTextPriority).toHaveBeenCalledWith(['src-hh-search:1'], -1);
  });

  it('a failed hh load without a platform refusal is also queued and pending', async () => {
    const engine = {
      loadVacancyDescription: vi.fn(async () => ({ unavailable: true, status: 'failed' as const })),
      requestHhTextPriority: vi.fn(),
    };
    await expect(loadDetailText(engine, 'src-hh-search:2', 50)).resolves.toMatchObject({
      pending: true,
    });
    expect(engine.requestHhTextPriority).toHaveBeenCalledWith(['src-hh-search:2'], -1);
  });

  it('other sources and hidden text are never pending', async () => {
    const engine = {
      loadVacancyDescription: vi.fn(async () => ({
        unavailable: true,
        status: 'skipped' as const,
        restricted: true,
      })),
      requestHhTextPriority: vi.fn(),
    };
    await expect(loadDetailText(engine, 'src-hh-search:3', 50)).resolves.not.toHaveProperty(
      'pending',
    );
    await expect(loadDetailText(engine, 'src-indeed:3', 50)).resolves.not.toHaveProperty('pending');
  });
});
