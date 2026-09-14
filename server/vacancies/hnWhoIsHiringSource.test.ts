import { describe, expect, it, vi } from 'vitest';
import {
  parseHnHeaderLine,
  parseHnCommentToVacancy,
  fetchHnWhoIsHiring,
  HN_SOURCE_ID,
} from './hnWhoIsHiringSource';

describe('Hacker News "Who is hiring" source', () => {
  describe('parseHnHeaderLine', () => {
    it('parses standard pipe-delimited header with company, title, location, remote, and salary', () => {
      const line = 'Acme Corp | Senior Backend Engineer | New York, NY | Remote | $150k-$200k';
      const parsed = parseHnHeaderLine(line);

      expect(parsed).not.toBeNull();
      expect(parsed?.company).toBe('Acme Corp');
      expect(parsed?.title).toBe('Senior Backend Engineer');
      expect(parsed?.location).toBe('New York, NY');
      expect(parsed?.isRemote).toBe(true);
      expect(parsed?.salary).toEqual({
        from: 150000,
        to: 200000,
        currency: 'USD',
      });
    });

    it('extracts skills and en-dash salary with equity from real HN post', () => {
      const line =
        'Lumen Labs | Robotics / Hardware Engineer | San Francisco, CA | ONSITE | Full-time | $130k–200k + equity';
      const parsed = parseHnHeaderLine(line);

      expect(parsed).not.toBeNull();
      expect(parsed?.company).toBe('Lumen Labs');
      expect(parsed?.title).toBe('Robotics / Hardware Engineer');
      expect(parsed?.location).toBe('San Francisco, CA');
      expect(parsed?.isRemote).toBe(false);
      expect(parsed?.employmentType).toBe('Full-time');
      expect(parsed?.salary).toEqual({
        from: 130000,
        to: 200000,
        currency: 'USD',
      });
    });

    it('handles remote restriction in location and comma-separated tech stack', () => {
      const line =
        'TinyCo | Staff Frontend Engineer | Remote (US/Canada) | $180k - $220k | React, TypeScript, GraphQL';
      const parsed = parseHnHeaderLine(line);

      expect(parsed).not.toBeNull();
      expect(parsed?.company).toBe('TinyCo');
      expect(parsed?.title).toBe('Staff Frontend Engineer');
      expect(parsed?.location).toBe('Remote (US/Canada)');
      expect(parsed?.isRemote).toBe(true);
      expect(parsed?.skills).toEqual(expect.arrayContaining(['React', 'TypeScript', 'GraphQL']));
      expect(parsed?.salary).toEqual({
        from: 180000,
        to: 220000,
        currency: 'USD',
      });
    });

    it('parses European currencies (EUR and GBP)', () => {
      const gbpLine = 'London AI | Machine Learning Lead | London, UK | Hybrid | £90k - £120k';
      const parsedGbp = parseHnHeaderLine(gbpLine);
      expect(parsedGbp?.salary).toEqual({
        from: 90000,
        to: 120000,
        currency: 'GBP',
      });

      const eurLine = 'Berlin Tech | Senior SRE | Berlin, Germany | Remote (EU) | €80,000 - €100,000';
      const parsedEur = parseHnHeaderLine(eurLine);
      expect(parsedEur?.salary).toEqual({
        from: 80000,
        to: 100000,
        currency: 'EUR',
      });
      expect(parsedEur?.isRemote).toBe(true);
    });

    it('detects explicit "No remote" or "ONSITE ONLY"', () => {
      const line = 'Defense Dynamics | Security Engineer | Washington, DC | ONSITE ONLY (no remote)';
      const parsed = parseHnHeaderLine(line);
      expect(parsed?.isRemote).toBe(false);
      expect(parsed?.location).toContain('Washington, DC');
    });

    it('does not confuse experience ranges (e.g. 3-5 years) with salary', () => {
      const line = 'Company | Role | Remote | 3-5 years | $180k - $220k';
      const parsed = parseHnHeaderLine(line);
      expect(parsed).not.toBeNull();
      expect(parsed?.company).toBe('Company');
      expect(parsed?.title).toBe('Role');
      expect(parsed?.isRemote).toBe(true);
      expect(parsed?.location).toBe('Remote');
      expect(parsed?.salary).toEqual({
        from: 180000,
        to: 220000,
        currency: 'USD',
      });
    });

    it('detects explicit "Remote: No" as non-remote', () => {
      const line = 'Fintech | Backend Dev | New York | Remote: No | $160k';
      const parsed = parseHnHeaderLine(line);
      expect(parsed?.isRemote).toBe(false);
      expect(parsed?.location).toBe('New York');
    });

    it('returns null for lines without pipes or missing required parts', () => {
      expect(parseHnHeaderLine('Just a regular comment with no pipes')).toBeNull();
      expect(parseHnHeaderLine('SinglePartOnly')).toBeNull();
      expect(parseHnHeaderLine('')).toBeNull();
    });

    it('returns null for bot guidelines or meta-instructions', () => {
      expect(
        parseHnHeaderLine('Please follow this format: Company | Role | Location | Remote'),
      ).toBeNull();
      expect(
        parseHnHeaderLine('Rules: Only hiring managers can post | No third-party recruiters'),
      ).toBeNull();
    });
  });

  describe('parseHnCommentToVacancy', () => {
    const storyId = 49522897;

    it('parses valid top-level HN comment into UnifiedVacancy', () => {
      const comment = {
        objectID: '49667711',
        parent_id: storyId,
        story_id: storyId,
        author: 'Daniel_Van_Zant',
        created_at: '2026-09-02T16:00:00Z',
        comment_text:
          'Lumen Labs | Robotics &#x2F; Hardware Engineer | San Francisco, CA | ONSITE | Full-time | $130k–200k + equity<p>Lumen Labs is building the cognitive layer for physical AI.<p>You: hands-on with real mobile robots, ROS2, Python.<p>Email hi@lumenresearch.co',
      };

      const vacancy = parseHnCommentToVacancy(comment, {
        observedAt: '2026-09-14T22:00:00Z',
        storyId,
      });

      expect(vacancy).not.toBeNull();
      expect(vacancy?.id).toBe('src-hn-whoishiring:49667711');
      expect(vacancy?.title).toBe('Robotics / Hardware Engineer');
      expect(vacancy?.company).toBe('Lumen Labs');
      expect(vacancy?.location).toBe('San Francisco, CA');
      expect(vacancy?.isRemote).toBe(false);
      expect(vacancy?.employmentType).toBe('Full-time');
      expect(vacancy?.salary).toEqual({
        from: 130000,
        to: 200000,
        currency: 'USD',
      });
      expect(vacancy?.url).toBe('https://news.ycombinator.com/item?id=49667711');
      expect(vacancy?.publishedAt).toBe('2026-09-02T16:00:00Z');
      expect(vacancy?.provenance).toEqual({
        sourceType: 'json_api',
        sourceId: HN_SOURCE_ID,
        sourceName: 'Hacker News (Who is hiring)',
        sourceUrl: 'https://news.ycombinator.com/item?id=49667711',
        externalId: '49667711',
        observedAt: '2026-09-14T22:00:00Z',
      });
      expect(vacancy?.description).toContain('Lumen Labs is building the cognitive layer');
      expect(vacancy?.fullDescription).toContain('Lumen Labs is building the cognitive layer');
    });

    it('rejects nested comments (parent_id !== story_id)', () => {
      const nestedComment = {
        objectID: '49693924',
        parent_id: 49530020,
        story_id: storyId,
        author: 'navalsaini',
        created_at: '2026-09-03T10:00:00Z',
        comment_text: 'Feedback or criticism.<p>There is a lot of delay in responses.',
      };

      expect(parseHnCommentToVacancy(nestedComment, { storyId })).toBeNull();
    });

    it('rejects meta-comments from whoishiring bot or moderators', () => {
      const botComment = {
        objectID: '49522898',
        parent_id: storyId,
        story_id: storyId,
        author: 'whoishiring',
        created_at: '2026-09-01T15:02:00Z',
        comment_text:
          'Please state the location and include REMOTE for remote work.<p>Please only post if you are personally part of the hiring company.',
      };

      expect(parseHnCommentToVacancy(botComment, { storyId })).toBeNull();
    });

    it('rejects candidate seeking employment / non-job chatter in thread', () => {
      const seekerComment = {
        objectID: '49686668',
        parent_id: storyId,
        story_id: storyId,
        author: 'job_seeker',
        created_at: '2026-09-02T12:00:00Z',
        comment_text:
          'Location: London, UK\nRemote: Yes\nWilling to relocate: No\nSeeking frontend roles.',
      };

      expect(parseHnCommentToVacancy(seekerComment, { storyId })).toBeNull();
    });

    it('rejects deleted or dead comments', () => {
      expect(
        parseHnCommentToVacancy({
          objectID: '111',
          parent_id: storyId,
          story_id: storyId,
          deleted: true,
          comment_text: null,
        }),
      ).toBeNull();

      expect(
        parseHnCommentToVacancy({
          objectID: '222',
          parent_id: storyId,
          story_id: storyId,
          dead: true,
          comment_text: '[dead]',
        }),
      ).toBeNull();
    });
  });

  describe('fetchHnWhoIsHiring', () => {
    it('queries Algolia search and comment endpoints to produce vacancies', async () => {
      const mockStoryId = '49522897';
      const mockFetchJson = vi.fn(async (url: string) => {
        if (url.includes('tags=story,author_whoishiring')) {
          return {
            hits: [
              {
                objectID: mockStoryId,
                title: 'Ask HN: Who is hiring? (September 2026)',
                created_at: '2026-09-01T15:01:17Z',
              },
            ],
          };
        }
        if (url.includes(`tags=comment,story_${mockStoryId}`)) {
          return {
            nbPages: 1,
            hits: [
              {
                objectID: '49667711',
                parent_id: Number(mockStoryId),
                story_id: Number(mockStoryId),
                author: 'Daniel_Van_Zant',
                created_at: '2026-09-02T16:00:00Z',
                comment_text:
                  'Lumen Labs | Robotics Engineer | San Francisco, CA | ONSITE | $150k<p>We build physical AI.',
              },
              {
                objectID: '49664325',
                parent_id: Number(mockStoryId),
                story_id: Number(mockStoryId),
                author: 'akimdelli22',
                created_at: '2026-09-02T17:00:00Z',
                comment_text:
                  'Ours Privacy | Platform Engineer | Remote (US) | $170k<p>Security platform.',
              },
              {
                // Nested comment should be skipped
                objectID: '49693924',
                parent_id: 49664325,
                story_id: Number(mockStoryId),
                author: 'someone_else',
                created_at: '2026-09-03T10:00:00Z',
                comment_text: 'Are you sponsoring visas?',
              },
            ],
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      });

      const vacancies = await fetchHnWhoIsHiring({
        fetchJson: mockFetchJson,
        nowMs: Date.parse('2026-09-14T22:00:00Z'),
      });

      expect(vacancies).toHaveLength(2);
      expect(vacancies[0]?.company).toBe('Lumen Labs');
      expect(vacancies[0]?.title).toBe('Robotics Engineer');
      expect(vacancies[1]?.company).toBe('Ours Privacy');
      expect(vacancies[1]?.isRemote).toBe(true);
      expect(mockFetchJson).toHaveBeenCalledTimes(2);
    });

    it('throws when no "Who is hiring" story is found in search', async () => {
      const mockFetchJson = vi.fn(async () => ({ hits: [] }));

      await expect(
        fetchHnWhoIsHiring({
          fetchJson: mockFetchJson,
        }),
      ).rejects.toThrow('hn_story_not_found');
    });

    it('filters out "Who wants to be hired" and "Freelancer" stories, picking "Who is hiring"', async () => {
      const mockFetchJson = vi.fn(async (url: string) => {
        if (url.includes('tags=story,author_whoishiring')) {
          return {
            hits: [
              {
                objectID: '1001',
                title: 'Ask HN: Who wants to be hired? (September 2026)',
              },
              {
                objectID: '1002',
                title: 'Ask HN: Freelancer? Seeking freelancer? (September 2026)',
              },
              {
                objectID: '49522897',
                title: 'Ask HN: Who is hiring? (September 2026)',
              },
            ],
          };
        }
        if (url.includes('tags=comment,story_49522897')) {
          return {
            nbPages: 1,
            hits: [
              {
                objectID: '49667711',
                parent_id: 49522897,
                story_id: 49522897,
                author: 'alice',
                created_at: '2026-09-02T16:00:00Z',
                comment_text: 'Beta | Dev | Remote | $150k',
              },
            ],
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      });

      const vacancies = await fetchHnWhoIsHiring({ fetchJson: mockFetchJson });
      expect(vacancies).toHaveLength(1);
      expect(vacancies[0]?.company).toBe('Beta');
    });
  });
});
