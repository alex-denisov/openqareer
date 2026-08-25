import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HH_SELECTORS } from './hhSelectors';

/**
 * The desktop shell decides "this candidate is signed in" by evaluating
 * `src-tauri/src/connector_inspection.js` inside the candidate's own session
 * webview. Nothing outside the desktop could evaluate that same decision, so
 * every check of it — including the live hh.ru evidence gate — used to be a
 * hand-written second copy. A copy that agrees with itself proves nothing: it
 * can pass while the desktop silently stops recognising a completed sign-in,
 * which is the failure the owner reported (B157).
 *
 * This module loads the one script the desktop ships and fills in the same two
 * values Rust fills in, so a Chromium run exercises the real recogniser.
 */
const SCRIPT_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'src-tauri',
  'src',
  'connector_inspection.js',
);

const PLATFORM_PLACEHOLDER = '__OPENQAREER_PLATFORM__';
const HH_MARKER_PLACEHOLDER = '__OPENQAREER_HH_MARKER__';

export type ConnectorInspectionPlatform = 'hh' | 'linkedin';

export interface ConnectorInspectionReport {
  readonly ready: boolean;
  readonly url: string;
  readonly signedInApplicant: boolean;
  readonly login: boolean;
  readonly otp: boolean;
  readonly captcha: boolean;
}

/** Fails loudly: a missing recogniser must never degrade into "not signed in". */
export function fillConnectorInspectionScript(
  source: string,
  platform: ConnectorInspectionPlatform,
): string {
  if (
    !source.includes(PLATFORM_PLACEHOLDER) ||
    !source.includes(HH_MARKER_PLACEHOLDER)
  ) {
    throw new Error('connector_inspection_script_placeholders_missing');
  }
  // A function replacer, because a `$` in a future selector would otherwise be
  // read as a substitution pattern and quietly corrupt the recogniser.
  const platformJson = JSON.stringify(platform);
  const markerJson = JSON.stringify(HH_SELECTORS.security.applicantProfile);
  return source
    .replaceAll(PLATFORM_PLACEHOLDER, () => platformJson)
    .replaceAll(HH_MARKER_PLACEHOLDER, () => markerJson);
}

/** The recogniser exactly as the desktop application ships it. */
export function connectorInspectionScript(
  platform: ConnectorInspectionPlatform,
): string {
  return fillConnectorInspectionScript(readFileSync(SCRIPT_PATH, 'utf8'), platform);
}
