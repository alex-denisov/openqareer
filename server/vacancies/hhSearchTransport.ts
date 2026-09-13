import { spawn } from 'node:child_process';
import type { HhSearchTransport, HhSearchTransportResult } from './hhSearchFetcher';

/**
 * Пути наружу до hh.ru (B214).
 *
 * Площадка отвечает не всем адресам: измерено 2026-09-13, что с прода
 * (Франкфурт) страница поиска отдаёт `200` и настоящую выдачу, а с рабочей
 * машины владельца — `451` на весь домен, включая `robots.txt`. Прямой путь
 * поэтому основной, а российский выход — запасной: он нужен, если площадка
 * закроет и адрес прода.
 *
 * Российский выход намеренно не открывает портов. Нода `eterapy-2` держит
 * боевую реплику БД другого проекта, и вешать на неё слушающий сервис ради
 * чтения вакансий — лишняя поверхность. Вместо этого на ней лежит скрипт,
 * привязанный к SSH-ключу принудительной командой: ключ умеет ровно одно —
 * прочитать один адрес hh.ru и вернуть тело. Ни произвольной команды, ни
 * другого узла этот ключ не даёт.
 */

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const DIRECT_TIMEOUT_MS = 30_000;
const EGRESS_TIMEOUT_MS = 45_000;

/** Прямой путь: обычный запрос с браузерным представлением. */
export const directHhTransport: HhSearchTransport = async (url) => {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
    });
    return { status: response.status, body: response.ok ? await response.text() : '' };
  } catch {
    // Недоступность — это отказ, а не пустая страница: разбор обязан упасть.
    return { status: 0, body: '' };
  }
};

export interface EgressTransportConfig {
  /** Путь к ключу с принудительной командой на выходной ноде. */
  readonly keyPath: string;
  /** `пользователь@узел` выходной ноды. */
  readonly target: string;
}

/**
 * Читает настройки выходной ноды из окружения. Отсутствие настроек — это не
 * ошибка: без них работает только прямой путь, и продукт обязан это пережить.
 */
export function readEgressConfig(
  env: NodeJS.ProcessEnv = process.env,
): EgressTransportConfig | null {
  const keyPath = env.OPENQAREER_HH_EGRESS_KEY?.trim();
  const target = env.OPENQAREER_HH_EGRESS_TARGET?.trim();
  if (!keyPath || !target) return null;
  return { keyPath, target };
}

/** Ответ выходного коннектора: первая строка — код и длина, дальше тело. */
export function parseEgressResponse(raw: string): HhSearchTransportResult {
  const separator = raw.indexOf('\n\n');
  if (separator < 0) return { status: 0, body: '' };
  const header = raw.slice(0, separator).trim().split(/\s+/);
  const status = Number.parseInt(header[0] ?? '', 10);
  return {
    status: Number.isFinite(status) ? status : 0,
    body: raw.slice(separator + 2),
  };
}

export function buildEgressTransport(config: EgressTransportConfig): HhSearchTransport {
  return (url) =>
    new Promise<HhSearchTransportResult>((resolve) => {
      const child = spawn(
        'ssh',
        [
          '-i',
          config.keyPath,
          '-o',
          'BatchMode=yes',
          '-o',
          'StrictHostKeyChecking=accept-new',
          '-o',
          `ConnectTimeout=${Math.floor(EGRESS_TIMEOUT_MS / 1000)}`,
          config.target,
        ],
        { stdio: ['pipe', 'pipe', 'ignore'] },
      );

      const chunks: Buffer[] = [];
      const timer = setTimeout(() => child.kill('SIGKILL'), EGRESS_TIMEOUT_MS);

      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.on('error', () => {
        clearTimeout(timer);
        resolve({ status: 0, body: '' });
      });
      child.on('close', () => {
        clearTimeout(timer);
        resolve(parseEgressResponse(Buffer.concat(chunks).toString('utf8')));
      });

      // Адрес уходит одной строкой — это весь протокол коннектора.
      child.stdin.end(`${url}\n`);
    });
}
