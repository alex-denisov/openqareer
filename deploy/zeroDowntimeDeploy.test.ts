import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// B705: выкат без простоя. Скрипты гоняются с заглушками systemctl, sudo,
// curl и caddy: «юнит» активен, пока есть файл, а /health порта отвечает SHA
// релиза, на который указывает slots/<порт>.

const DEPLOY = import.meta.dirname;
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const isLinux = process.platform === 'linux';

const STUBS: Record<string, string> = {
  id: `#!/usr/bin/env bash
case "$1" in -un) echo openqareer-deploy ;; -u) echo 1000 ;; *) exec /usr/bin/id "$@" ;; esac`,
  flock: `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STATE/flock.log"
[[ -f "$STATE/lock-held" ]] && exit 1
exit 0`,
  sleep: '#!/usr/bin/env bash\nexit 0',
  // BSD mv has no -T; the scripts only use it to replace a symlink atomically.
  mv: `#!/usr/bin/env bash
if [[ "$1" == "-Tf" ]]; then exec python3 -c 'import os,sys; os.replace(sys.argv[1], sys.argv[2])' "$2" "$3"; fi
exec /bin/mv "$@"`,
  sudo: `#!/usr/bin/env bash
[[ "$1" == "-n" ]] && shift
printf '%s\\n' "$*" >> "$STATE/sudo.log"
case "$1" in
  /usr/bin/systemctl) shift; exec systemctl "$@" ;;
  /usr/local/bin/openqareer-upstream) shift; exec bash "$DEPLOY_DIR/openqareer-upstream" "$@" ;;
esac
exit 99`,
  systemctl: `#!/usr/bin/env bash
port_of() { [[ "$1" =~ ^openqareer-static@([0-9]+)\\.service$ ]] && printf '%s' "\${BASH_REMATCH[1]}"; }
case "$1" in
  show)
    if [[ "$*" == *TimeoutStopUSec* ]]; then echo 5min; exit 0; fi
    prop="$3"; unit="\${@: -1}"
    if [[ "$prop" == NRestarts && -f "$STATE/restarting-$unit" ]]; then
      n="$(cat "$STATE/nrestarts-$unit" 2>/dev/null || echo 0)"; echo "$n"; echo $((n + 1)) > "$STATE/nrestarts-$unit"
    elif [[ "$prop" == MainPID ]]; then echo 4242
    elif [[ "$prop" == ExecStart ]]; then
      if [[ -f "$STATE/execstart-$unit" ]]; then cat "$STATE/execstart-$unit"
      else echo "{ path=node ; argv[]=node $RELEASE_ROOT/current/main.mjs }"; fi
    else echo 0; fi ;;
  cat) exit 0 ;;
  is-active) [[ -f "$STATE/active/$3" ]] ;;
  enable|disable)
    if [[ "$2" == "--now" ]]; then rm -f "$STATE/active/$3"; fi
    echo "$1 \${@: -1}" >> "$STATE/units.log" ;;
  stop) rm -f "$STATE/active/$2"; echo "stop $2" >> "$STATE/units.log" ;;
  restart)
    port="$(port_of "$2")"
    [[ -n "$port" && -f "$STATE/fail-start-$port" ]] && exit 1
    touch "$STATE/active/$2"; echo "restart $2" >> "$STATE/units.log"
    if [[ -n "$port" ]]; then basename "$(readlink "$RELEASE_ROOT/slots/$port")" > "$STATE/health-$port"; fi ;;
  reload) [[ -f "$STATE/fail-reload" ]] && exit 1; echo "reload $2" >> "$STATE/units.log" ;;
  *) exit 0 ;;
esac`,
  curl: `#!/usr/bin/env bash
url="\${@: -1}"; [[ "$url" =~ :([0-9]+)/health$ ]] || exit 7
port="\${BASH_REMATCH[1]}"
[[ -f "$STATE/active/openqareer-static@$port.service" && ! -f "$STATE/unhealthy-$port" ]] || exit 7
cat "$STATE/health-$port"`,
  caddy: `#!/usr/bin/env bash
[[ -f "$STATE/caddy-invalid" ]] && exit 1
exit 0`,
};

interface Host {
  root: string;
  state: string;
  snippet: string;
  env: NodeJS.ProcessEnv;
}

function makeHost(): Host {
  const base = mkdtempSync(join(tmpdir(), 'oq-zdd-'));
  const root = join(base, 'srv');
  const state = join(base, 'state');
  const bin = join(base, 'bin');
  for (const dir of [
    root,
    join(root, 'releases'),
    join(root, 'incoming'),
    state,
    join(state, 'active'),
    bin,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(bin, name), `${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const snippet = join(base, 'openqareer-upstream.caddy');
  writeFileSync(join(base, 'Caddyfile'), 'import openqareer-upstream.caddy\n');
  return {
    root,
    state,
    snippet,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      STATE: state,
      DEPLOY_DIR: DEPLOY,
      RELEASE_ROOT: root,
      OPENQAREER_RELEASE_ROOT: root,
      OPENQAREER_SLOTS_LIB: join(DEPLOY, 'openqareer-slots.sh'),
      OPENQAREER_UPSTREAM_FILE: snippet,
      OPENQAREER_CADDYFILE: join(base, 'Caddyfile'),
      OPENQAREER_HEALTH_WINDOW_SECONDS: '2',
      OPENQAREER_DRAIN_SECONDS: '0',
      OPENQAREER_RESERVE_SECONDS: '0',
      OPENQAREER_RESERVE_POLL_SECONDS: '0',
    },
  };
}

interface Fingerprints {
  maintenance?: string;
  mechanics?: string;
}

function writeFingerprints(dir: string, fingerprints: Fingerprints = {}): void {
  if (fingerprints.maintenance) {
    writeFileSync(join(dir, 'maintenance.fingerprint'), `${fingerprints.maintenance}\n`);
  }
  if (fingerprints.mechanics) {
    writeFileSync(join(dir, 'vacancy-mechanics.fingerprint'), `${fingerprints.mechanics}\n`);
  }
}

function addRelease(host: Host, sha: string, fingerprints?: Fingerprints): void {
  const dir = join(host.root, 'releases', sha);
  mkdirSync(dir, { recursive: true });
  for (const file of ['index.html', 'server.mjs', 'maintenance.mjs'])
    writeFileSync(join(dir, file), '');
  writeFileSync(join(dir, 'health'), `${sha}\n`);
  writeFingerprints(dir, fingerprints);
}

const MAINTENANCE = 'openqareer-maintenance.service';
const MECHANICS = 'openqareer-vacancy-mechanics.service';

/** B759: workers already run from their own links on `sha`, units installed after bootstrap. */
function workersOnLinks(host: Host, sha: string): void {
  for (const [unit, linkName, file] of [
    [MAINTENANCE, 'maintenance', 'maintenance.mjs'],
    [MECHANICS, 'mechanics', 'vacancy-mechanics-worker.mjs'],
  ] as const) {
    symlinkSync(`releases/${sha}`, join(host.root, linkName));
    writeFileSync(
      join(host.state, `execstart-${unit}`),
      `{ path=node ; argv[]=node ${host.root}/${linkName}/${file} }\n`,
    );
    writeFileSync(join(host.state, 'active', unit), '');
  }
}

/** Host as it serves today: one instance live on `port`, Caddy pointed at it. */
function serving(
  host: Host,
  sha: string,
  port: '3210' | '3211',
  options: { legacy?: boolean; fingerprints?: Fingerprints } = {},
): void {
  addRelease(host, sha, options.fingerprints);
  symlinkSync(`releases/${sha}`, join(host.root, 'current'));
  if (options.legacy) {
    writeFileSync(join(host.state, 'active', 'openqareer-static.service'), '');
    return;
  }
  mkdirSync(join(host.root, 'slots'), { recursive: true });
  symlinkSync(`../releases/${sha}`, join(host.root, 'slots', port));
  writeFileSync(join(host.state, 'active', `openqareer-static@${port}.service`), '');
  writeFileSync(join(host.state, `health-${port}`), `${sha}\n`);
  writeFileSync(host.snippet, `to 127.0.0.1:${port}\n`);
}

function run(host: Host, script: string, args: string[] = []) {
  return spawnSync('bash', [join(DEPLOY, script), ...args], { env: host.env, encoding: 'utf8' });
}

const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const isActive = (host: Host, unit: string): boolean =>
  existsSync(join(host.state, 'active', unit));
const link = (host: Host, name: string): string => readlinkSync(join(host.root, name));

function stageArchive(
  host: Host,
  sha: string,
  options: { noReserve?: boolean; fingerprints?: Fingerprints } = {},
): string {
  const src = mkdtempSync(join(tmpdir(), 'oq-zdd-src-'));
  for (const file of ['index.html', 'server.mjs', 'maintenance.mjs'])
    writeFileSync(join(src, file), '');
  if (options.noReserve) writeFileSync(join(src, 'no-warm-reserve'), '');
  writeFingerprints(src, options.fingerprints);
  writeFileSync(join(src, 'health'), `${sha}\n`);
  const archive = join(host.root, 'incoming', `${sha}.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', src, '.']);
  rmSync(src, { recursive: true });
  return createHash('sha256').update(readFileSync(archive)).digest('hex');
}

describe('openqareer-rollback: возврат без простоя (B705)', () => {
  it('прежний релиз ещё жив на свободном порту — одно переключение Caddy', () => {
    const host = makeHost();
    serving(host, SHA_B, '3211');
    addRelease(host, SHA_A);
    symlinkSync(`releases/${SHA_A}`, join(host.root, 'previous'));
    symlinkSync(`../releases/${SHA_A}`, join(host.root, 'slots', '3210'));
    writeFileSync(join(host.state, 'active', 'openqareer-static@3210.service'), '');
    writeFileSync(join(host.state, 'health-3210'), `${SHA_A}\n`);

    const result = run(host, 'openqareer-rollback');

    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('mode=instant');
    expect(read(host.snippet)).toBe('to 127.0.0.1:3210\n');
    expect(read(join(host.state, 'units.log'))).not.toContain(
      'restart openqareer-static@3210.service',
    );
    expect(link(host, 'current')).toBe(`releases/${SHA_A}`);
    expect(link(host, 'previous')).toBe(`releases/${SHA_B}`);
    expect(isActive(host, 'openqareer-static@3211.service')).toBe(false);
  });

  it('прежний релиз остановлен — поднимает его рядом и переключает после /health', () => {
    const host = makeHost();
    serving(host, SHA_B, '3211');
    addRelease(host, SHA_A);
    symlinkSync(`releases/${SHA_A}`, join(host.root, 'previous'));

    const result = run(host, 'openqareer-rollback');

    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('mode=warm');
    expect(link(host, 'slots/3210')).toBe(`../releases/${SHA_A}`);
    const units = read(join(host.state, 'units.log'));
    // Новый поднят и Caddy перезагружен раньше, чем остановлен прежний.
    expect(units.indexOf('restart openqareer-static@3210.service')).toBeLessThan(
      units.indexOf('reload caddy'),
    );
    expect(units.indexOf('reload caddy')).toBeLessThan(
      units.indexOf('stop openqareer-static@3211.service'),
    );
    expect(read(host.snippet)).toBe('to 127.0.0.1:3210\n');
    expect(isActive(host, 'openqareer-static@3210.service')).toBe(true);
  });

  it('прежний релиз не отвечает /health — трафик остаётся на текущем', () => {
    const host = makeHost();
    serving(host, SHA_B, '3211');
    addRelease(host, SHA_A);
    symlinkSync(`releases/${SHA_A}`, join(host.root, 'previous'));
    writeFileSync(join(host.state, 'unhealthy-3210'), '');

    const result = run(host, 'openqareer-rollback');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('current release still serving');
    expect(read(host.snippet)).toBe('to 127.0.0.1:3211\n');
    expect(link(host, 'current')).toBe(`releases/${SHA_B}`);
    expect(isActive(host, 'openqareer-static@3211.service')).toBe(true);
    expect(isActive(host, 'openqareer-static@3210.service')).toBe(false);
  });
});

/** Window after a deploy: new release primary on 3210, old one reserve on 3211. */
function inReserveWindow(host: Host): void {
  serving(host, SHA_B, '3211');
  addRelease(host, SHA_C);
  symlinkSync(`../releases/${SHA_C}`, join(host.root, 'slots', '3210'));
  writeFileSync(join(host.state, 'active', 'openqareer-static@3210.service'), '');
  writeFileSync(join(host.state, 'health-3210'), `${SHA_C}\n`);
  rmSync(join(host.root, 'current'));
  symlinkSync(`releases/${SHA_C}`, join(host.root, 'current'));
  symlinkSync(`releases/${SHA_B}`, join(host.root, 'previous'));
  writeFileSync(host.snippet, 'to 127.0.0.1:3210 127.0.0.1:3211\nlb_policy first\n');
}

describe('openqareer-reserve-watch: тёплый резерв 10 минут (B705-2)', () => {
  it('окно прошло без падений — резерв убран из Caddy и погашен', () => {
    const host = makeHost();
    inReserveWindow(host);

    const result = run(host, 'openqareer-reserve-watch', ['3210']);

    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('window passed without failures');
    expect(read(host.snippet)).toBe('to 127.0.0.1:3210\n');
    expect(isActive(host, 'openqareer-static@3211.service')).toBe(false);
    expect(link(host, 'current')).toBe(`releases/${SHA_C}`);
  });

  it('новый экземпляр упал — Caddy на резерв, current откатан, причина в журнале', () => {
    const host = makeHost();
    inReserveWindow(host);
    rmSync(join(host.state, 'active', 'openqareer-static@3210.service'));
    host.env.OPENQAREER_RESERVE_SECONDS = '5';
    // Exit code of the stopped unit is irrelevant: the watcher only needs it gone.
    const result = run(host, 'openqareer-reserve-watch', ['3210']);

    expect(result.stdout).toContain('FAILOVER: openqareer-static@3210.service is not active');
    expect(read(host.snippet)).toBe('to 127.0.0.1:3211\n');
    expect(link(host, 'current')).toBe(`releases/${SHA_B}`);
    expect(link(host, 'previous')).toBe(`releases/${SHA_C}`);
    expect(isActive(host, 'openqareer-static@3211.service')).toBe(true);
    expect(read(join(host.state, 'units.log'))).toContain('restart openqareer-maintenance.service');
  });

  it('systemd перезапустил новый экземпляр — это тоже отказ, хотя юнит снова active', () => {
    const host = makeHost();
    inReserveWindow(host);
    writeFileSync(join(host.state, 'restarting-openqareer-static@3210.service'), '');
    host.env.OPENQAREER_RESERVE_SECONDS = '5';
    const result = run(host, 'openqareer-reserve-watch', ['3210']);
    expect(result.stdout).toContain('FAILOVER: systemd restarted openqareer-static@3210.service');
    expect(read(host.snippet)).toBe('to 127.0.0.1:3211\n');
    expect(isActive(host, 'openqareer-static@3210.service')).toBe(false);
  });

  it('ждёт блокировку выката, а не уходит сразу: выкат ещё перезапускает maintenance', () => {
    const host = makeHost();
    inReserveWindow(host);
    rmSync(join(host.state, 'active', 'openqareer-static@3210.service'));
    host.env.OPENQAREER_RESERVE_SECONDS = '5';
    const result = run(host, 'openqareer-reserve-watch', ['3210']);
    expect(result.stdout).toContain('FAILOVER');
    expect(read(join(host.state, 'flock.log'))).toContain('-w 900 9');
  });

  it('блокировка так и не освободилась — резерв оставлен выкату, Caddy не тронут', () => {
    const host = makeHost();
    inReserveWindow(host);
    writeFileSync(join(host.state, 'lock-held'), '');
    const result = run(host, 'openqareer-reserve-watch', ['3210']);
    expect(result.stdout).toContain('deploy lock still held');
    expect(read(host.snippet)).toContain('to 127.0.0.1:3210 127.0.0.1:3211');
  });

  it('резерва нет — сторож ничего не трогает', () => {
    const host = makeHost();
    serving(host, SHA_C, '3210');
    const result = run(host, 'openqareer-reserve-watch', ['3210']);
    expect(result.stdout).toContain('nothing to watch');
    expect(read(host.snippet)).toBe('to 127.0.0.1:3210\n');
  });
});

describe('openqareer-upstream: переключение Caddy (B705)', () => {
  it('основной и резерв — оба адреса и проверки здоровья; один порт дважды нельзя', () => {
    const host = makeHost();
    writeFileSync(host.snippet, 'to 127.0.0.1:3211\n');
    expect(run(host, 'openqareer-upstream', ['3210', '3211']).status).toBe(0);
    const snippet = read(host.snippet);
    expect(snippet).toContain('to 127.0.0.1:3210 127.0.0.1:3211');
    expect(snippet).toContain('fail_duration 30s');
    expect(snippet).toContain('health_interval 2s');
    expect(run(host, 'openqareer-upstream', ['3210', '3210']).status).not.toBe(0);
    expect(run(host, 'openqareer-upstream', ['3210', '8080']).status).not.toBe(0);
  });

  it('принимает только 3210 и 3211', () => {
    const host = makeHost();
    const result = run(host, 'openqareer-upstream', ['8080']);
    expect(result.status).not.toBe(0);
    expect(existsSync(host.snippet)).toBe(false);
  });

  it('невалидный Caddyfile — сниппет возвращается, reload не делается', () => {
    const host = makeHost();
    writeFileSync(host.snippet, 'to 127.0.0.1:3210\n');
    writeFileSync(join(host.state, 'caddy-invalid'), '');
    const result = run(host, 'openqareer-upstream', ['3211']);
    expect(result.status).not.toBe(0);
    expect(read(host.snippet)).toBe('to 127.0.0.1:3210\n');
    expect(read(join(host.state, 'units.log'))).toBe('');
  });

  it('reload упал — прежний upstream возвращён', () => {
    const host = makeHost();
    writeFileSync(host.snippet, 'to 127.0.0.1:3210\n');
    writeFileSync(join(host.state, 'fail-reload'), '');
    expect(run(host, 'openqareer-upstream', ['3211']).status).not.toBe(0);
    expect(read(host.snippet)).toBe('to 127.0.0.1:3210\n');
  });

  it('повтор с тем же портом ничего не перезагружает', () => {
    const host = makeHost();
    writeFileSync(host.snippet, 'to 127.0.0.1:3211\n');
    const result = run(host, 'openqareer-upstream', ['3211']);
    expect(result.stdout).toContain('unchanged');
    expect(read(join(host.state, 'units.log'))).toBe('');
  });
});

describe('bootstrap.sh: sudoers покрывает каждый вызов sudo (B705)', () => {
  it('каждая команда sudo из activate/rollback разрешена ровно одной строкой', () => {
    const base = mkdtempSync(join(tmpdir(), 'oq-zdd-sudoers-'));
    const out = join(base, 'sudoers');
    const bin = join(base, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'visudo'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(bin, 'cmp'), '#!/usr/bin/env bash\nexit 1\n');
    writeFileSync(join(bin, 'install'), `#!/usr/bin/env bash\ncp "\${@: -2:1}" "${out}"\n`);
    for (const name of ['visudo', 'cmp', 'install']) chmodSync(join(bin, name), 0o755);
    const bootstrap = readFileSync(join(DEPLOY, 'bootstrap.sh'), 'utf8');
    const fn = /^install_sudoers\(\) \{[\s\S]*?^\}/m.exec(bootstrap)?.[0];
    expect(fn).toBeDefined();
    execFileSync('bash', ['-c', `fail() { echo "$1" >&2; exit 1; }\n${fn}\ninstall_sudoers`], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
    });
    const allowed = new Set(
      read(out)
        .trim()
        .split('\n')
        .map((line) => line.replace('openqareer-deploy ALL=(root) NOPASSWD: ', '')),
    );
    const scripts = [
      'openqareer-slots.sh',
      'openqareer-activate',
      'openqareer-rollback',
      'openqareer-reserve-watch',
    ]
      .map((file) => readFileSync(join(DEPLOY, file), 'utf8'))
      .join('\n');
    for (const port of ['3210', '3211']) {
      for (const verb of ['restart', 'stop', 'enable', 'disable']) {
        expect(allowed).toContain(`/usr/bin/systemctl ${verb} openqareer-static@${port}.service`);
      }
      expect(allowed).toContain(`/usr/local/bin/openqareer-upstream ${port}`);
    }
    expect(allowed).toContain('/usr/bin/systemctl disable --now openqareer-static.service');
    for (const port of ['3210', '3211']) {
      expect(allowed).toContain(`/usr/bin/systemctl restart openqareer-reserve@${port}.service`);
      expect(allowed).toContain(`/usr/bin/systemctl stop openqareer-reserve@${port}.service`);
    }
    expect(allowed).toContain('/usr/local/bin/openqareer-upstream 3210 3211');
    expect(allowed).toContain('/usr/local/bin/openqareer-upstream 3211 3210');
    expect(scripts).toContain('sudo -n "$UPSTREAM_HELPER"');
    expect([...allowed].every((line) => !line.includes('*'))).toBe(true);
  });
});

describe.runIf(isLinux)('openqareer-activate: выкат без простоя (B705, Linux)', () => {
  it('первый выкат после установки: новый релиз на 3211, прежний сервис выключен', () => {
    const host = makeHost();
    serving(host, SHA_A, '3210', { legacy: true });
    const checksum = stageArchive(host, SHA_B);

    const result = run(host, 'openqareer-activate', [SHA_B, checksum]);

    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(`release=${SHA_B} health=ok port=3211`);
    expect(read(host.snippet)).toBe('to 127.0.0.1:3211\n');
    expect(link(host, 'current')).toBe(`releases/${SHA_B}`);
    expect(link(host, 'previous')).toBe(`releases/${SHA_A}`);
    expect(isActive(host, 'openqareer-static.service')).toBe(false);
    expect(isActive(host, 'openqareer-static@3211.service')).toBe(true);
    const units = read(join(host.state, 'units.log'));
    expect(units.indexOf('reload caddy')).toBeLessThan(
      units.indexOf('disable openqareer-static.service'),
    );
  });

  it('следующий выкат чередует порт и оставляет прежний экземпляр тёплым резервом (B705-2)', () => {
    const host = makeHost();
    serving(host, SHA_B, '3211');
    const checksum = stageArchive(host, SHA_C);

    const result = run(host, 'openqareer-activate', [SHA_C, checksum]);

    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('port=3210 reserve=3211');
    const snippet = read(host.snippet);
    expect(snippet.split('\n')[0]).toBe('to 127.0.0.1:3210 127.0.0.1:3211');
    expect(snippet).toContain('health_uri /health');
    expect(snippet).toContain('lb_policy first');
    expect(isActive(host, 'openqareer-static@3210.service')).toBe(true);
    expect(isActive(host, 'openqareer-static@3211.service')).toBe(true);
    expect(read(join(host.state, 'units.log'))).toContain(
      'restart openqareer-reserve@3210.service',
    );
  });

  it('маркер no-warm-reserve в релизе — резерва нет, прежний гасится после переключения', () => {
    const host = makeHost();
    serving(host, SHA_B, '3211');
    const checksum = stageArchive(host, SHA_C, { noReserve: true });

    const result = run(host, 'openqareer-activate', [SHA_C, checksum]);

    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('reserve=none');
    expect(read(host.snippet)).toBe('to 127.0.0.1:3210\n');
    expect(isActive(host, 'openqareer-static@3211.service')).toBe(false);
    const units = read(join(host.state, 'units.log'));
    expect(units.indexOf('reload caddy')).toBeLessThan(
      units.indexOf('stop openqareer-static@3211.service'),
    );
    expect(units).not.toContain('openqareer-reserve@');
  });

  it('новый релиз не ответил /health — Caddy и current не тронуты', () => {
    const host = makeHost();
    serving(host, SHA_B, '3211');
    const checksum = stageArchive(host, SHA_C);
    writeFileSync(join(host.state, 'unhealthy-3210'), '');

    const result = run(host, 'openqareer-activate', [SHA_C, checksum]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('previous release still serving');
    expect(read(host.snippet)).toBe('to 127.0.0.1:3211\n');
    expect(link(host, 'current')).toBe(`releases/${SHA_B}`);
    expect(isActive(host, 'openqareer-static@3211.service')).toBe(true);
    expect(isActive(host, 'openqareer-static@3210.service')).toBe(false);
  });

  it('Caddy не принял переключение — current возвращён, новый экземпляр погашен', () => {
    const host = makeHost();
    serving(host, SHA_B, '3211');
    const checksum = stageArchive(host, SHA_C);
    writeFileSync(join(host.state, 'caddy-invalid'), '');

    const result = run(host, 'openqareer-activate', [SHA_C, checksum]);

    expect(result.status).not.toBe(0);
    expect(read(host.snippet)).toBe('to 127.0.0.1:3211\n');
    expect(link(host, 'current')).toBe(`releases/${SHA_B}`);
    expect(isActive(host, 'openqareer-static@3210.service')).toBe(false);
  });
});

describe.runIf(isLinux)(
  'openqareer-activate: обслуживание перезапускается по отпечатку (B759, Linux)',
  () => {
    const SAME = { maintenance: '1'.repeat(64), mechanics: '2'.repeat(64) };
    const restarts = (host: Host): string[] =>
      read(join(host.state, 'units.log'))
        .split('\n')
        .filter((line) => line === `restart ${MAINTENANCE}` || line === `restart ${MECHANICS}`);

    it('отпечатки те же — обслуживание и воркер не перезапускаются, ссылки на прежнем релизе', () => {
      const host = makeHost();
      serving(host, SHA_B, '3211', { fingerprints: SAME });
      workersOnLinks(host, SHA_B);
      const checksum = stageArchive(host, SHA_C, { fingerprints: SAME });

      const result = run(host, 'openqareer-activate', [SHA_C, checksum]);

      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('maintenance=kept mechanics=kept');
      expect(restarts(host)).toEqual([]);
      expect(link(host, 'maintenance')).toBe(`releases/${SHA_B}`);
      expect(link(host, 'mechanics')).toBe(`releases/${SHA_B}`);
      expect(link(host, 'current')).toBe(`releases/${SHA_C}`);
    });

    it('отпечаток обслуживания другой — его ссылка на новом релизе и он перезапущен, воркер нет', () => {
      const host = makeHost();
      serving(host, SHA_B, '3211', { fingerprints: SAME });
      workersOnLinks(host, SHA_B);
      const checksum = stageArchive(host, SHA_C, {
        fingerprints: { ...SAME, maintenance: '3'.repeat(64) },
      });

      const result = run(host, 'openqareer-activate', [SHA_C, checksum]);

      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('maintenance=restarted mechanics=kept');
      expect(restarts(host)).toEqual([`restart ${MAINTENANCE}`]);
      expect(link(host, 'maintenance')).toBe(`releases/${SHA_C}`);
      expect(link(host, 'mechanics')).toBe(`releases/${SHA_B}`);
    });

    it('юнит ещё смотрит на current (до bootstrap) — перезапуск всегда, как раньше', () => {
      const host = makeHost();
      serving(host, SHA_B, '3211', { fingerprints: SAME });
      const checksum = stageArchive(host, SHA_C, { fingerprints: SAME });

      const result = run(host, 'openqareer-activate', [SHA_C, checksum]);

      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('maintenance=restarted mechanics=restarted');
      expect(restarts(host)).toEqual([`restart ${MAINTENANCE}`, `restart ${MECHANICS}`]);
    });

    it('в релизе нет отпечатка — перезапуск: без него совпадение не доказано', () => {
      const host = makeHost();
      serving(host, SHA_B, '3211', { fingerprints: SAME });
      workersOnLinks(host, SHA_B);
      const checksum = stageArchive(host, SHA_C);

      const result = run(host, 'openqareer-activate', [SHA_C, checksum]);

      expect(result.stdout).toContain('maintenance=restarted mechanics=restarted');
    });

    it('обслуживание не активно — перезапускается, хотя отпечаток тот же', () => {
      const host = makeHost();
      serving(host, SHA_B, '3211', { fingerprints: SAME });
      workersOnLinks(host, SHA_B);
      rmSync(join(host.state, 'active', MAINTENANCE));
      const checksum = stageArchive(host, SHA_C, { fingerprints: SAME });

      const result = run(host, 'openqareer-activate', [SHA_C, checksum]);

      expect(result.stdout).toContain('maintenance=restarted mechanics=kept');
    });

    it('чистка релизов не удаляет релиз, с которого работает обслуживание', () => {
      const host = makeHost();
      const oldest = '0'.repeat(40);
      addRelease(host, oldest, SAME);
      utimesSync(join(host.root, 'releases', oldest), 1, 1);
      for (const sha of ['1', '2', '3', '4', '5'].map((digit) => digit.repeat(40))) {
        addRelease(host, sha, SAME);
      }
      serving(host, SHA_B, '3211', { fingerprints: SAME });
      workersOnLinks(host, oldest);
      const checksum = stageArchive(host, SHA_C, { fingerprints: SAME });

      const result = run(host, 'openqareer-activate', [SHA_C, checksum]);

      expect(result.stderr).toBe('');
      expect(existsSync(join(host.root, 'releases', oldest))).toBe(true);
      expect(link(host, 'maintenance')).toBe(`releases/${oldest}`);
    });
  },
);

describe('bootstrap.sh и юниты обслуживания (B759)', () => {
  it('юниты запускают код со своих ссылок, а не с current', () => {
    expect(read(join(DEPLOY, 'openqareer-maintenance.service'))).toContain(
      'ExecStart=/opt/openqareer/node-v24.14.1-linux-x64/bin/node /srv/openqareer/maintenance/maintenance.mjs',
    );
    expect(read(join(DEPLOY, 'openqareer-vacancy-mechanics.service'))).toContain(
      '/srv/openqareer/mechanics/vacancy-mechanics-worker.mjs',
    );
  });

  it('bootstrap создаёт недостающие ссылки до перезапуска юнитов в обоих режимах', () => {
    const bootstrap = read(join(DEPLOY, 'bootstrap.sh'));
    const unitsOnly = /^install_units_only\(\) \{[\s\S]*?^\}/m.exec(bootstrap)?.[0] ?? '';
    expect(unitsOnly.indexOf('ensure_worker_links')).toBeGreaterThan(-1);
    expect(unitsOnly.indexOf('ensure_worker_links')).toBeLessThan(
      unitsOnly.indexOf('systemctl restart'),
    );
    const tail = bootstrap.slice(bootstrap.lastIndexOf('ensure_worker_links'));
    expect(tail.indexOf('systemctl restart openqareer-maintenance.service')).toBeGreaterThan(0);
    const ensure = /^ensure_worker_links\(\) \{[\s\S]*?^\}/m.exec(bootstrap)?.[0] ?? '';
    expect(ensure).toContain('if [[ ! -L "$RELEASE_ROOT/$link_name" ]]');
  });
});
