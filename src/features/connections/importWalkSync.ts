import type { ImportWalk } from '../coach/coachApi';
import { saveImportWalk } from './importWalkApi';
import type { LinkedInImportProgressEvent } from './linkedinImportProgress';

type WalkBody = Pick<ImportWalk, 'state' | 'sections'>;

/**
 * The server copy of the LinkedIn walk (B541): the profile reads it after a
 * reload, so «LinkedIn: прочитано 3 из 7» does not vanish with the window.
 */
export function nextImportWalk(
  walk: WalkBody | null,
  event: LinkedInImportProgressEvent,
): WalkBody | null {
  if (event.type === 'start')
    return { state: 'running', sections: event.keys.map((key) => ({ key, status: 'pending' })) };
  if (!walk) return null;
  if (event.type === 'end') return { ...walk, state: 'done' };
  const status = event.type === 'read' ? 'read' : 'failed';
  return {
    ...walk,
    sections: walk.sections.map((section) =>
      section.key === event.key ? { ...section, status } : section,
    ),
  };
}

export function createImportWalkSync(
  save: (platform: 'linkedin', walk: WalkBody) => Promise<void> = saveImportWalk,
): (event: LinkedInImportProgressEvent) => void {
  let walk: WalkBody | null = null;
  return (event) => {
    const next = nextImportWalk(walk, event);
    if (!next || next === walk) return;
    walk = next;
    // The walk is a convenience copy: a failed save must never stop the import.
    save('linkedin', next).catch(() => undefined);
  };
}
