import { createContext, useContext } from 'react';

/** The signed-in candidate's display name, for screens that write on their behalf. */
export const CandidateDisplayNameContext = createContext<string | null>(null);

export function useCandidateDisplayName(): string | null {
  const name = useContext(CandidateDisplayNameContext)?.trim();
  return name ? name : null;
}
