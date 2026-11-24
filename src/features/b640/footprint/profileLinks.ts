import { saveResumeStudioDraft } from '../../resume/resumeApi';
import { freshDraft, PROFILE_CHANGED } from '../profile/ExperienceEditScreen';
import { linksFull, withLink, withoutLink } from './addLinkModel';
import { rememberAddedLink } from './footprintApi';
import { announceFootprintChanged } from './useFootprint';

function announce(): void {
  window.dispatchEvent(new Event(PROFILE_CHANGED));
  announceFootprintChanged();
}

/** Ссылка ложится в контакты профиля: план поиска строится по ним. */
export async function saveLink(link: string): Promise<'saved' | 'full'> {
  const draft = await freshDraft();
  if (linksFull(draft, link)) return 'full';
  const next = withLink(draft, link);
  if (next !== draft) await saveResumeStudioDraft(next);
  await rememberAddedLink(link);
  announce();
  return 'saved';
}

/** B668: ссылка убрана из контактов профиля — в план поиска она больше не входит. */
export async function removeLink(link: string): Promise<void> {
  const draft = await freshDraft();
  const next = withoutLink(draft, link);
  if (next !== draft) await saveResumeStudioDraft(next);
  announce();
}
