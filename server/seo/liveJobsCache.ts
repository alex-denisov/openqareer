import { liveJobsLine, type LiveCardPath } from './liveSitemap';

/**
 * B776 (prod 23.11): a job sitemap file checked its 10 000 lines against the live catalog in one
 * go, 3–6 s on the event loop per file, again every minute as crawlers walked jobs-1…6. The check
 * now yields between chunks, and a file older than the interval is answered from the last copy
 * while one rebuild runs behind it.
 */
const CHUNK_LINES = 200;

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function liveJobsXmlChunked(xml: string, livePath: LiveCardPath, chunk = CHUNK_LINES): Promise<string> {
  const lines = xml.split('\n');
  const kept: string[] = [];
  for (let start = 0; start < lines.length; start += chunk) {
    if (start > 0) await nextTurn();
    for (const line of lines.slice(start, start + chunk)) kept.push(...liveJobsLine(line, livePath));
  }
  return kept.join('\n');
}

interface LiveCopy {
  readonly source: string;
  readonly xml: string;
  readonly at: number;
}

export class LiveJobsCache {
  private readonly copies = new Map<string, LiveCopy>();
  private readonly building = new Map<string, Promise<string>>();

  constructor(
    private readonly ttlMs: number,
    private readonly clock: () => number = Date.now,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  /** Fresh copy as is; an old copy of the same build at once, rebuilt behind; otherwise built now. */
  async read(name: string, source: string, livePath: LiveCardPath): Promise<string> {
    const copy = this.copies.get(name);
    if (copy?.source === source) {
      if (this.clock() - copy.at >= this.ttlMs) void this.rebuild(name, source, livePath).catch(this.onError);
      return copy.xml;
    }
    return this.rebuild(name, source, livePath);
  }

  /** Waits for the rebuilds running now (tests, shutdown). */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.building.values()]);
  }

  private rebuild(name: string, source: string, livePath: LiveCardPath): Promise<string> {
    const key = `${name}\u0000${source.length}`;
    const running = this.building.get(key);
    if (running) return running;
    const build = liveJobsXmlChunked(source, livePath)
      .then((xml) => {
        this.copies.set(name, { source, xml, at: this.clock() });
        return xml;
      })
      .finally(() => this.building.delete(key));
    this.building.set(key, build);
    return build;
  }
}
