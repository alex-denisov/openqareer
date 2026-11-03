/**
 * Text whose UTF-8 bytes were read as Latin-1 somewhere upstream: «’» arrives
 * as «â\u0080\u0099» and a no-break space as «Â\u00a0» (RemoteOK API, 03.11).
 *
 * Only a run shaped exactly like one UTF-8 sequence (a lead byte, then its
 * continuation bytes) is re-decoded, and only when it decodes cleanly, so
 * correctly decoded accents («é», «Ø», «ü») are never touched.
 */
const UTF8_AS_LATIN1 = /[Â-ß][\u0080-¿]|[à-ï][\u0080-¿]{2}|[ð-ô][\u0080-¿]{3}/gu;

export function repairMojibake(text: string): string {
  return text.replace(UTF8_AS_LATIN1, (run) => {
    const decoded = Buffer.from(run, 'latin1').toString('utf8');
    return decoded.includes('�') ? run : decoded;
  });
}
