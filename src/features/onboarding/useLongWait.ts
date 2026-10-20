import { useEffect, useState } from 'react';

import { FIRST_RUN_STALE_DELAY_MS } from './firstRunSpecialState';

/** true, когда `active` держится дольше `delayMs`; сбрасывается вместе с ним. */
export function useLongWait(active: boolean, delayMs = FIRST_RUN_STALE_DELAY_MS): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!active) {
      setLong(false);
      return;
    }
    const timer = window.setTimeout(() => setLong(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);
  return active && long;
}
