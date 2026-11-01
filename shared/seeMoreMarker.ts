// LinkedIn's collapsed text ends with «…more»; an import could keep it (01.11).
const SEE_MORE_TAIL = /\s*(?:…|\.{3})\s*(?:see more|show more|more|ещё|еще|показать больше)\s*$/iu;
const DOT_RUN = /\.{3,}/gu;

/** The text without the platform's «… more» tail and with one ellipsis for a run of dots. */
export function withoutSeeMoreMarker(text: string): string {
  const cut = text.replace(SEE_MORE_TAIL, '');
  const truncated = cut !== text && !/[.…!?]$/u.test(cut) ? `${cut}…` : cut;
  return truncated.replace(DOT_RUN, '…');
}
