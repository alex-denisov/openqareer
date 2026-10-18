import { useEffect, useState } from 'react';
import { getCandidateFootprintAudit } from '../reputation/candidateFootprintApi';

/**
 * «Цифровой след 3» in the approved Profile mockup: the number of findings the
 * candidate still sees (not rejected or hidden). Unknown until the audit read
 * lands, and a failed read shows no number rather than a guessed one.
 */
export function useFootprintFindingCount(candidateId: string): number | undefined {
  const [count, setCount] = useState<number>();
  useEffect(() => {
    let current = true;
    void getCandidateFootprintAudit()
      .then((audit) => {
        if (!current) return;
        const visible = audit?.findings.filter(
          (finding) => finding.review !== 'not_self' && finding.review !== 'hidden',
        );
        setCount(visible?.length ? visible.length : undefined);
      })
      .catch(() => {
        if (current) setCount(undefined);
      });
    return () => {
      current = false;
    };
  }, [candidateId]);
  return count;
}
