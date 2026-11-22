import { parentPort } from 'node:worker_threads';
import type { HhFetchWorkerReply, HhFetchWorkerRequest } from './hhFetchInWorker';
import { createDirectHhTransport } from './hhSearchTransport';

/**
 * B756: поток выборки hh.ru (dist/hh-fetch-worker.mjs). Соединения undici,
 * срок 30 с и чтение тела живут на цикле событий этого потока; задержка цикла
 * в замерах — тоже его. Замер уходит отдельным сообщением до ответа.
 */
function startWorker(): void {
  const port = parentPort;
  if (!port) return;
  const post = (reply: HhFetchWorkerReply): void => port.postMessage(reply);
  const fetchPage = createDirectHhTransport({ onFetch: (event) => post({ event }) });
  port.on('message', (request: HhFetchWorkerRequest) => {
    void fetchPage(request.url).then(
      (result) => post({ id: request.id, result }),
      () => post({ id: request.id, result: { status: 0, body: '', failure: 'WorkerError' } }),
    );
  });
}

startWorker();
