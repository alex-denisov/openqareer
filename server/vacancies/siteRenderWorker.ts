import { parentPort, workerData } from 'node:worker_threads';
import { createScriptPageRenderer, launchSiteRenderBrowser } from './scriptPageRenderer';
import type { RenderWorkerReply, RenderWorkerRequest } from './siteRenderInWorker';

/**
 * B643: поток рендера (dist/site-render-worker.mjs). Браузер, page.route и
 * pinnedFetch живут на цикле событий этого потока, а не обслуживания.
 */

export interface SiteRenderWorkerData {
  readonly moduleSpecifier: string;
  readonly executablePath?: string;
}

function startWorker(): void {
  const port = parentPort;
  if (!port) return;
  const data = workerData as SiteRenderWorkerData;
  const post = (reply: RenderWorkerReply): void => port.postMessage(reply);
  const render = createScriptPageRenderer({
    launch: () => launchSiteRenderBrowser(data.moduleSpecifier, data.executablePath),
    log: (fields, message) => post({ log: { fields, message } }),
  });
  port.on('message', (request: RenderWorkerRequest) => {
    render(request.url).then(
      (html) => post(html === undefined ? { id: request.id } : { id: request.id, html }),
      () => post({ id: request.id }),
    );
  });
}

startWorker();
