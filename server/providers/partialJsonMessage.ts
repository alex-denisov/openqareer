/**
 * The text of the top-level `message` field of a JSON object that is still
 * arriving (29.10, streamed consultant reply). The model answers by schema, so
 * the candidate reads the reply while the rest of the object is generated.
 *
 * Stateless: the caller passes everything received so far. An escape cut by a
 * chunk boundary is held back until it is complete; `undefined` means the
 * message value has not started yet.
 */
export function partialJsonMessage(raw: string): string | undefined {
  const start = raw.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let expectKey = false;
  let key: string | undefined;
  let awaitingValue = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') {
      const text = readString(raw, index);
      if (depth === 1 && awaitingValue && key === 'message') return text.value;
      if (!text.closed) return undefined;
      if (depth === 1 && expectKey) key = text.value;
      expectKey = false;
      awaitingValue = false;
      index = text.end;
    } else if (char === '{' || char === '[') {
      depth += 1;
      expectKey = char === '{' && depth === 1;
      awaitingValue = false;
    } else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return undefined;
    } else if (char === ':' && depth === 1) {
      awaitingValue = true;
    } else if (char === ',' && depth === 1) {
      expectKey = true;
      key = undefined;
      awaitingValue = false;
    } else if (!/\s/.test(char ?? '')) {
      // A literal (number, null, true, false) answers the key: it is not the message.
      awaitingValue = false;
    }
  }
  return undefined;
}

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/** Decodes a JSON string from its opening quote; `end` is the closing quote. */
function readString(raw: string, quote: number): { value: string; closed: boolean; end: number } {
  let value = '';
  let index = quote + 1;
  while (index < raw.length) {
    const char = raw[index];
    if (char === '"') return { value, closed: true, end: index };
    if (char !== '\\') {
      value += char;
      index += 1;
      continue;
    }
    const escape = raw[index + 1];
    if (escape === undefined) break;
    if (escape !== 'u') {
      value += SIMPLE_ESCAPES[escape] ?? escape;
      index += 2;
      continue;
    }
    const hex = raw.slice(index + 2, index + 6);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
    value += String.fromCharCode(Number.parseInt(hex, 16));
    index += 6;
  }
  return { value: withoutLoneHighSurrogate(value), closed: false, end: raw.length };
}

/** A high surrogate at the very end waits for its pair: alone it renders as garbage. */
function withoutLoneHighSurrogate(value: string): string {
  const last = value.charCodeAt(value.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? value.slice(0, -1) : value;
}
