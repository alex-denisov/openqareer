import { getSortedMatchedPage } from '../b640Api';
import { SERVER_SORT } from './sortModel';

/** Число вакансий подборки по ролям — тот же итог, что сервер отдаёт списку; `null`, если не прочитан. */
export async function readSelectionTotal(
  roles: readonly string[],
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const page = await getSortedMatchedPage(SERVER_SORT, roles, 0, signal);
    return page.total;
  } catch {
    return null;
  }
}
