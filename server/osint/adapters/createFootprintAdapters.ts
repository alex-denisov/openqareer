import type { ServerConfig } from '../../config';
import type { FootprintAdapter } from './footprintAdapter';
import type { ExaAdapterInput } from './exaAdapter';
import type { HibpAdapterInput } from './hibpAdapter';
import { MAIGRET_SITES } from './maigretSiteCatalogue';
import { createExaAdapter } from './exaAdapter';
import { createHibpAdapter } from './hibpAdapter';
import { createMaigretAdapter } from './maigretAdapter';
import { createSherlockAdapter } from './sherlockAdapter';
import { FootprintRequestGate, sharedFootprintRequestGate } from './requestScheduler';
import { createWaybackAdapter } from './waybackAdapter';
import type { UsernamePresenceInput } from './usernamePresenceAdapter';
import type { WaybackAdapterInput } from './waybackAdapter';

export interface FootprintAdapterSet {
  readonly sherlock: readonly FootprintAdapter<UsernamePresenceInput>[];
  readonly maigret: readonly FootprintAdapter<UsernamePresenceInput>[];
  readonly hibp: FootprintAdapter<HibpAdapterInput>;
  readonly wayback: FootprintAdapter<WaybackAdapterInput>;
  readonly exa: FootprintAdapter<ExaAdapterInput>;
}

export interface FootprintAdapterSetOptions {
  readonly config: Pick<ServerConfig, 'hibpApiKey' | 'exaApiKey'>;
  readonly fetch?: typeof fetch;
  readonly resolveHost?: (hostname: string) => Promise<readonly string[]>;
  readonly now?: () => Date;
  readonly requestGate?: FootprintRequestGate;
}

export function createFootprintAdapterSet(options: FootprintAdapterSetOptions): FootprintAdapterSet {
  const requestGate = options.requestGate ?? sharedFootprintRequestGate;
  const common = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
    requestGate,
  };
  return {
    sherlock: MAIGRET_SITES
      .filter((site) => site.adapterId === 'sherlock')
      .map((site) => createSherlockAdapter({ ...common, site })),
    maigret: MAIGRET_SITES
      .filter((site) => site.adapterId === 'maigret')
      .map((site) => createMaigretAdapter({ ...common, site })),
    hibp: createHibpAdapter({
      ...common,
      ...(options.config.hibpApiKey ? { apiKey: options.config.hibpApiKey } : {}),
    }),
    wayback: createWaybackAdapter({
      ...common,
      ...(options.resolveHost ? { resolveHost: options.resolveHost } : {}),
    }),
    exa: createExaAdapter({
      ...common,
      ...(options.config.exaApiKey ? { apiKey: options.config.exaApiKey } : {}),
    }),
  };
}
