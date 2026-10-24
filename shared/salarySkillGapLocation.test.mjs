// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
it('requests only the selected aggregate scope and rejects a response from a different region', async () => {
  vi.stubGlobal('location', new URL('https://openqareer.com/salaries/analyst'));
  document.body.innerHTML =
    '<section data-sm-gap data-role="analyst" data-grade="senior" data-location="europe"><form data-gap-form><textarea></textarea><button disabled>Compare</button></form><p role="status"></p><div data-gap-results hidden></div></section>';
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        role: 'analyst',
        grade: 'senior',
        location: 'europe',
        updatedAt: '2026-10-24T00:00:00Z',
        sampleSize: 5,
        skills: [{ name: 'SQL', count: 2, frequency: 40 }],
      },
    }),
  });
  vi.stubGlobal('fetch', fetcher);
  try {
    await import('../public/assets/oq-salary-gap-2.js');
    document.querySelector('textarea').value = 'SQL';
    document
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector('[data-gap-results]').hidden).toBe(false));
    const [url, options] = fetcher.mock.calls[0];
    expect(url.toString()).toBe(
      'https://openqareer.com/api/v1/public/salary-markets/analyst/skills?grade=senior&location=europe',
    );
    expect(options.body).toBeUndefined();
    expect(options.credentials).toBe('omit');
    expect(document.querySelector('[data-gap-results]').textContent).toContain('2 из 5');
    fetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          role: 'analyst',
          grade: 'senior',
          updatedAt: '2026-10-24T00:00:00Z',
          sampleSize: 20,
          skills: [{ name: 'SQL', count: 10, frequency: 50 }],
        },
      }),
    });
    document
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(document.querySelector('[role="status"]').textContent).toContain('недоступен'),
    );
    expect(document.querySelector('[data-gap-results]').hidden).toBe(true);
  } finally {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  }
});
