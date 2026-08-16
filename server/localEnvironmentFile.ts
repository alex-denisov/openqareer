/**
 * Resolves the single local secret-exchange file (`DEPLOY.md` §7).
 *
 * The repository working tree must never hold a secret file: a `.gitignore`
 * entry is one careless `git add -f` away from a committed credential, and a
 * per-checkout copy silently drifts from the owner's real values. The canonical
 * file is `~/.openqareer/openqareer.env` (0600) inside `~/.openqareer` (0700).
 *
 * `OPENQAREER_LOCAL_ENV_PATH` exists so CI and systemd can name their own file;
 * it must be absolute, because a relative override would re-introduce exactly
 * the working-tree copy this module removes.
 */
const OVERRIDE_KEY = 'OPENQAREER_LOCAL_ENV_PATH';
const DIRECTORY_NAME = '.openqareer';
const FILE_NAME = 'openqareer.env';

export function resolveLocalEnvironmentFilePath(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const override = environment[OVERRIDE_KEY]?.trim();
  if (override) {
    if (!override.startsWith('/')) {
      throw new Error(`${OVERRIDE_KEY} must be an absolute path`);
    }
    return override;
  }
  const home = environment.HOME?.trim();
  if (!home) {
    throw new Error(
      `no home directory is known; set ${OVERRIDE_KEY} to the absolute secret file path`,
    );
  }
  return `${home.replace(/\/+$/u, '')}/${DIRECTORY_NAME}/${FILE_NAME}`;
}
