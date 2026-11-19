import { apiFetch, readData } from '../../../coach/apiClient';
import type { LinkedinJournalPage } from '../../../../../shared/b640LinkedinJournal';

const URL = '/api/v1/candidate/b640/linkedin/journal';

/** B696: журнал LinkedIn — собственные события платформы и отметки «ответил», по 20. */
export async function getLinkedinJournal(offset: number, limit = 20): Promise<LinkedinJournalPage> {
  return readData<LinkedinJournalPage>(await apiFetch(`${URL}?offset=${offset}&limit=${limit}`));
}
