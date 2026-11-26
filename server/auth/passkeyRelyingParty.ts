import type { ServerConfig } from '../config';

/** Сайт, на котором живут ключи доступа: в проде openqareer.com, при разработке localhost. */
export interface PasskeyRelyingParty {
  readonly name: string;
  readonly id: string;
  readonly origins: readonly string[];
}

const PROD: PasskeyRelyingParty = {
  name: 'openqareer',
  id: 'openqareer.com',
  origins: ['https://openqareer.com'],
};
const DEV: PasskeyRelyingParty = {
  name: 'openqareer',
  id: 'localhost',
  origins: ['http://localhost:3000'],
};

/** Прод определяет `secureCookies` (NODE_ENV=production): тот же признак, что у списка разрешённых источников. */
export function passkeyRelyingParty(
  config: Pick<ServerConfig, 'secureCookies'>,
): PasskeyRelyingParty {
  return config.secureCookies ? PROD : DEV;
}
