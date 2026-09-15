import { describe, expect, it, vi } from 'vitest';
import {
  buildObscuraCliArgs,
  ObscuraRunner,
  resolveObscuraBinPath,
  type ObscuraRunnerConfig,
} from '../obscuraRunner';

describe('ObscuraRunner (Rust + V8 lightweight engine)', () => {
  it('resolves binary path from config or environment override', () => {
    const customPath = '/opt/custom/obscura';
    expect(resolveObscuraBinPath({ binaryPath: customPath })).toBe(customPath);
  });

  it('builds CLI args with stealth, dump format, and storage options', () => {
    const config: ObscuraRunnerConfig = {
      userDataDir: '/tmp/profile-1',
      proxyUrl: 'http://proxy.internal:8080',
    };
    const args = buildObscuraCliArgs('https://example.com/jobs', 'html', config, {
      userAgent: 'CustomUA/1.0',
    });

    expect(args).toContain('fetch');
    expect(args).toContain('https://example.com/jobs');
    expect(args).toContain('--stealth');
    expect(args).toContain('--dump');
    expect(args).toContain('html');
    expect(args).toContain('--storage-dir');
    expect(args).toContain('/tmp/profile-1');
    expect(args).toContain('--proxy');
    expect(args).toContain('http://proxy.internal:8080');
    expect(args).toContain('--user-agent');
    expect(args).toContain('CustomUA/1.0');
  });

  it('fetches HTML and filters out stderr logs', async () => {
    const mockExec = vi.fn().mockResolvedValue({
      stdout: '<html><body><h1>Jobs</h1></body></html>',
      stderr: 'Fetching https://example.com/jobs...\nPage loaded: https://example.com/jobs\n',
    });

    const runner = new ObscuraRunner(
      { binaryPath: '/mock/obscura' },
      { execFile: mockExec as never },
    );

    const html = await runner.fetchHtml('https://example.com/jobs');
    expect(html).toBe('<html><body><h1>Jobs</h1></body></html>');
    expect(mockExec).toHaveBeenCalledWith(
      '/mock/obscura',
      expect.arrayContaining(['fetch', 'https://example.com/jobs', '--stealth', '--dump', 'html']),
      expect.any(Object),
    );
  });

  it('fetches cookies and parses JSON cookie jar', async () => {
    const mockCookies = [
      { name: 'cf_clearance', value: 'secret123', domain: '.example.com', path: '/' },
    ];
    const mockExec = vi.fn().mockResolvedValue({
      stdout: JSON.stringify(mockCookies),
      stderr: 'Fetching...\n',
    });

    const runner = new ObscuraRunner(
      { binaryPath: '/mock/obscura' },
      { execFile: mockExec as never },
    );

    const cookies = await runner.fetchCookies('https://example.com');
    expect(cookies).toEqual(mockCookies);
  });

  it('provides openPage API compatible with linkedinScraper and jobspyAdapters', async () => {
    const mockExec = vi.fn().mockResolvedValue({
      stdout: '<div>Listing</div>',
      stderr: '',
    });

    const runner = new ObscuraRunner(
      { binaryPath: '/mock/obscura' },
      { execFile: mockExec as never },
    );

    const page = await runner.openPage('https://example.com/listing');
    expect(page.url()).toBe('https://example.com/listing');
    expect(await page.content()).toBe('<div>Listing</div>');
    await runner.close();
  });
});
