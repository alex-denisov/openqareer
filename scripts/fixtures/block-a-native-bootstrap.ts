import {
  applyLinkedInImportProgress,
  type LinkedInImportStageKey,
} from '../../src/features/connections/linkedinImportProgress';

const stages: readonly LinkedInImportStageKey[] = [
  'experience',
  'education',
  'skills',
  'languages',
  'projects',
  'courses',
  'contactInfo',
];

document.documentElement.dataset.blockAQaBootstrap = 'local-progress-events-v1';

// Imported only by the disposable Demo build's separate HTML fixture entry.
// These shortcuts exercise the actual reducer; they do not start a provider import.
document.addEventListener('keydown', (event) => {
  if (!event.ctrlKey || !event.altKey || event.metaKey) return;
  if (event.code === 'KeyI') {
    event.preventDefault();
    applyLinkedInImportProgress({ type: 'start', keys: stages });
    stages.slice(0, 3).forEach((key) => applyLinkedInImportProgress({ type: 'read', key }));
    document.documentElement.dataset.blockAImportFixture = 'synthetic-3-of-7';
  } else if (event.code === 'KeyU') {
    event.preventDefault();
    applyLinkedInImportProgress({ type: 'end' });
    document.documentElement.dataset.blockAImportFixture = 'inactive';
  } else if (event.code === 'KeyR') {
    event.preventDefault();
    location.reload();
  }
});
