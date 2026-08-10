import { useState } from 'react';
import { startConnection } from '../coach/coachApi';
import { PLATFORM_LABELS, type ConnectionPlatform } from './connectionResult';
import { accountRequiredNotice, connectionStartNotice } from './connectionState';
import { PlatformConnectionPanel } from './PlatformConnectionPanel';

interface PlatformConnectionSectionProps {
  platform: ConnectionPlatform;
  /** Connections are stored per account, so an anonymous visitor is not asked. */
  hasAccount: boolean;
}

/**
 * The connection is only requested when the candidate asks for it: nothing is
 * read from the account until the button is pressed, and every refusal is
 * reported in the candidate's own terms.
 */
export function PlatformConnectionSection({
  platform,
  hasAccount,
}: PlatformConnectionSectionProps) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();

  async function handleConnect() {
    setBusy(true);
    setNotice(undefined);
    try {
      const started = await startConnection(platform);
      window.location.assign(started.authorizationUrl);
    } catch (error) {
      setBusy(false);
      setNotice(connectionStartNotice(error, platform));
    }
  }

  if (!hasAccount) {
    return (
      <p className="career-inline-note">{accountRequiredNotice(platform)}</p>
    );
  }

  return (
    <>
      <PlatformConnectionPanel
        platform={platform}
        busy={busy}
        onConnect={() => void handleConnect()}
      />
      {notice ? (
        <p className="career-inline-note" role="status">
          {notice}
        </p>
      ) : null}
    </>
  );
}

export { PLATFORM_LABELS };
