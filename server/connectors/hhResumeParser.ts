import type { ProfileUrlImportResult } from './profileUrlImport';
import { parseHhResumeHtml } from '../../src/services/connectors/hhResumeParser';
export { parseHhResumeHtml };

// eslint-disable-next-line max-lines-per-function
export async function parseHhResumeFromUrl(
  url: string,
  options: {
    fetchImpl?: typeof fetch;
    now?: () => string;
  } = {},
): Promise<ProfileUrlImportResult> {
  const fetcher = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());

  try {
    let response = await fetcher(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok && (response.status === 451 || response.status === 403)) {
      const setCookies = (response.headers as unknown as { getSetCookie?: () => string[] })
        ?.getSetCookie?.() ??
        (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')!] : []);
      if (setCookies.length > 0) {
        const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
        response = await fetcher(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept':
              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cookie': cookieHeader,
          },
        });
      }
    }

    if (!response.ok) {
      return {
        status: 'unavailable',
        platform: 'hh',
        sourceUrl: url,
        reason: response.status === 403 || response.status === 451 ? 'authwall' : 'network',
        nextAction: 'upload_export_or_pdf',
      };
    }

    const html = await response.text();
    if (html.includes('VPN мешает работе сайта') || html.includes('vpn-cheeck')) {
      return {
        status: 'unavailable',
        platform: 'hh',
        sourceUrl: url,
        reason: 'authwall',
        nextAction: 'upload_export_or_pdf',
      };
    }

    const parsed = parseHhResumeHtml(html, url);

    const facts: Array<{
      kind: 'headline' | 'summary';
      value: string;
      sourceLocator: string;
      confidence: 'public-metadata';
    }> = [];

    if (parsed.targetRole) {
      facts.push({
        kind: 'headline',
        value: parsed.targetRole,
        sourceLocator: `${url}#headline`,
        confidence: 'public-metadata',
      });
    }

    if (parsed.about) {
      facts.push({
        kind: 'summary',
        value: parsed.about,
        sourceLocator: `${url}#about`,
        confidence: 'public-metadata',
      });
    } else if (parsed.experience.length > 0) {
      const topExp = parsed.experience[0];
      facts.push({
        kind: 'summary',
        value: `${topExp.title} в ${topExp.employer}. Ключевые навыки: ${parsed.skills.slice(0, 5).join(', ')}`,
        sourceLocator: `${url}#top-experience`,
        confidence: 'public-metadata',
      });
    }

    return {
      status: 'imported',
      platform: 'hh',
      sourceUrl: url,
      capturedAt: now(),
      accessPath: 'permitted_public_page',
      facts,
      parsedResume: parsed,
    };
  } catch {
    return {
      status: 'unavailable',
      platform: 'hh',
      sourceUrl: url,
      reason: 'network',
      nextAction: 'upload_export_or_pdf',
    };
  }
}
