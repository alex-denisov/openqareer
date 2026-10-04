import {
  FootprintSourceError,
  type FootprintAdapter,
  type FootprintFinding,
  type FootprintMatch,
} from './footprintAdapter';

export interface GithubSecretsInput {
  readonly username: string;
}

interface SecretPattern {
  readonly id: string;
  readonly name: string;
  readonly regex: RegExp;
  readonly risk: 'высокий' | 'критический';
}

const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    id: 'aws',
    name: 'ключ AWS',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    risk: 'критический',
  },
  {
    id: 'github_token',
    name: 'токен GitHub',
    regex: /\bgh[pousr]_[0-9a-zA-Z]{36}\b/g,
    risk: 'критический',
  },
  {
    id: 'secret_key',
    name: 'секретный ключ API (sk-*)',
    regex: /\bsk-(?:live_|test_)?[0-9a-zA-Z]{20,}\b/g,
    risk: 'критический',
  },
  {
    id: 'slack_token',
    name: 'токен Slack',
    regex: /\bxox[baprs]-[0-9a-zA-Z]{10,}\b/g,
    risk: 'критический',
  },
  {
    id: 'private_key',
    name: 'приватный криптографический ключ',
    regex: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g,
    risk: 'критический',
  },
  {
    id: 'internal_domain',
    name: 'внутренний корпоративный домен',
    regex: /https?:\/\/[a-zA-Z0-9.-]+\.(?:corp|internal|local)(?::[0-9]+)?(?:\/[^\s"'`<>)]*)?/g,
    risk: 'высокий',
  },
];

const SCAN_EXTENSIONS = new Set([
  'env',
  'json',
  'yml',
  'yaml',
  'xml',
  'js',
  'ts',
  'jsx',
  'tsx',
  'py',
  'go',
  'rb',
  'php',
  'sh',
  'bash',
  'properties',
  'conf',
  'config',
  'txt',
  'toml',
  'ini',
  'sql',
]);

const MAX_FILE_SIZE = 200 * 1024;
const MAX_FILES_PER_REPO = 200;
const MAX_REPOS = 30;

interface GithubRepoItem {
  readonly name: string;
  readonly default_branch?: string;
  readonly html_url?: string;
  readonly owner: { readonly login: string };
}

interface GithubTreeItem {
  readonly path?: string;
  readonly type?: string;
  readonly size?: number;
}

export class GithubSecretsAdapter implements FootprintAdapter<GithubSecretsInput> {
  readonly id = 'githubSecrets';
  readonly passive = true as const;

  constructor(private readonly fetchFn: typeof fetch = globalThis.fetch) {}

  async run(input: GithubSecretsInput, signal?: AbortSignal): Promise<readonly FootprintFinding[]> {
    if (signal?.aborted) {
      throw new Error('Операция отменена');
    }

    const username = input.username.trim();
    if (!username) return [];

    const repos = await this.fetchUserRepos(username, signal);
    const findings: FootprintFinding[] = [];
    const now = new Date().toISOString();

    for (const repo of repos.slice(0, MAX_REPOS)) {
      if (signal?.aborted) {
        throw new Error('Операция отменена');
      }
      const branch = repo.default_branch ?? 'main';
      const tree = await this.fetchRepoTree(repo.owner.login, repo.name, branch, signal);
      const scannable = filterScannableFiles(tree);

      for (const file of scannable) {
        if (signal?.aborted) {
          throw new Error('Операция отменена');
        }
        await this.scanFile(repo, branch, file, username, now, findings, signal);
      }
    }

    return findings;
  }

  private async fetchUserRepos(
    username: string,
    signal?: AbortSignal,
  ): Promise<readonly GithubRepoItem[]> {
    const url = `https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=${MAX_REPOS}`;
    const res = await this.request(url, signal);
    return (await res.json()) as GithubRepoItem[];
  }

  private async fetchRepoTree(
    owner: string,
    repo: string,
    branch: string,
    signal?: AbortSignal,
  ): Promise<readonly GithubTreeItem[]> {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    try {
      const res = await this.request(url, signal);
      const data = (await res.json()) as { tree?: readonly GithubTreeItem[] };
      return data.tree ?? [];
    } catch (err) {
      if (err instanceof FootprintSourceError) throw err;
      return [];
    }
  }

  private async scanFile(
    repo: GithubRepoItem,
    branch: string,
    filePath: string,
    username: string,
    now: string,
    findings: FootprintFinding[],
    signal?: AbortSignal,
  ): Promise<void> {
    const match: FootprintMatch = 'likely_self';
    const receipt = { method: 'github_tree_scan', source: 'github', query: username };
    const fileUrl = repo.html_url ? `${repo.html_url}/blob/${branch}/${filePath}` : null;

    if (isRootEnvFile(filePath)) {
      findings.push({
        adapter: this.id,
        kind: 'secret',
        url: fileUrl,
        title: 'Обнаружен файл переменных окружения: .env',
        detail: `В корне репозитория «${repo.name}» обнаружен файл окружения: ${filePath}. Публикация .env файлов создаёт прямую угрозу компрометации конфигурации. Риск: критический.`,
        match,
        observedAt: now,
        receipt,
      });
    }

    const content = await this.fetchFileContent(
      repo.owner.login,
      repo.name,
      branch,
      filePath,
      signal,
    );
    if (!content) return;

    scanTextForSecrets(
      content,
      filePath,
      repo.name,
      fileUrl,
      now,
      receipt,
      findings,
      this.id,
      match,
    );
  }

  private async fetchFileContent(
    owner: string,
    repo: string,
    branch: string,
    filePath: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${filePath}`;
    try {
      const res = await this.fetchFn(rawUrl, {
        signal,
        headers: { 'User-Agent': 'openqareer-osint' },
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  private async request(url: string, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = {
      'User-Agent': 'openqareer-osint',
      Accept: 'application/vnd.github.v3+json',
    };
    const token = process.env.OPENQAREER_GITHUB_TOKEN;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let res: Response;
    try {
      res = await this.fetchFn(url, { signal, headers });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Операция отменена');
      }
      throw new FootprintSourceError(
        'github',
        'source_error',
        `Сетевая ошибка при обращении к GitHub: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }

    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0' || res.status === 429) {
        throw new FootprintSourceError(
          'github',
          'source_error',
          'лимит GitHub, повторите через час',
          true,
        );
      }
      const body = await res.text().catch(() => '');
      if (body.toLowerCase().includes('rate limit')) {
        throw new FootprintSourceError(
          'github',
          'source_error',
          'лимит GitHub, повторите через час',
          true,
        );
      }
      throw new FootprintSourceError(
        'github',
        'source_error',
        `Доступ к GitHub ограничен (код ${res.status})`,
        false,
      );
    }

    if (!res.ok) {
      throw new FootprintSourceError(
        'github',
        'source_error',
        `Ошибка GitHub API: статус ${res.status}`,
        res.status >= 500,
      );
    }

    return res;
  }
}

export const githubSecretsAdapter = new GithubSecretsAdapter();

function isRootEnvFile(path: string): boolean {
  if (path === '.env') return true;
  return /^\.env\.[a-zA-Z0-9._-]+$/.test(path);
}

function filterScannableFiles(tree: readonly GithubTreeItem[]): string[] {
  const result: string[] = [];
  for (const item of tree) {
    if (!item.path || item.type !== 'blob') continue;
    if (item.size && item.size > MAX_FILE_SIZE) continue;
    const path = item.path;
    const baseName = path.split('/').pop() ?? '';
    const ext = baseName.split('.').pop()?.toLowerCase() ?? '';

    if (baseName.startsWith('.env') || SCAN_EXTENSIONS.has(ext)) {
      result.push(path);
      if (result.length >= MAX_FILES_PER_REPO) break;
    }
  }
  return result;
}

function scanTextForSecrets(
  content: string,
  filePath: string,
  repoName: string,
  fileUrl: string | null,
  now: string,
  receipt: FootprintFinding['receipt'],
  findings: FootprintFinding[],
  adapterId: string,
  match: FootprintMatch,
): void {
  const lines = content.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(line)) {
        const lineNum = lineIdx + 1;
        const lineUrl = fileUrl ? `${fileUrl}#L${lineNum}` : null;
        findings.push({
          adapter: adapterId,
          kind: 'secret',
          url: lineUrl,
          title: `Обнаружен секрет в публичном коде: ${pattern.name}`,
          detail: `В репозитории «${repoName}» найден ${pattern.name} в ${filePath}, строка ${lineNum}. Риск: ${pattern.risk}.`,
          match,
          observedAt: now,
          receipt,
        });
      }
    }
  }
}
