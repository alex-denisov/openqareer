import { useEffect, useState } from 'react';
import type { FootprintMetadataCheck } from '../../../shared/footprintChecklist';
import { getCandidateFootprintMetadataCheck } from './candidateFootprintApi';

/** B544: null until the check answers or when it fails — the item then reads «Файлы не проверялись». */
export function useFootprintMetadataCheck(candidateId: string): FootprintMetadataCheck | null {
  const [check, setCheck] = useState<FootprintMetadataCheck | null>(null);
  useEffect(() => {
    let active = true;
    setCheck(null);
    getCandidateFootprintMetadataCheck()
      .then((result) => {
        if (active) setCheck(result);
      })
      .catch(() => {
        if (active) setCheck(null);
      });
    return () => {
      active = false;
    };
  }, [candidateId]);
  return check;
}
