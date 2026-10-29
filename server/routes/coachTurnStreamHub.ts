/**
 * The consultant's reply while it is generated (29.10, owner): one entry per
 * running turn, inside the process that runs it. The text lives here only
 * until the turn ends — the stored result stays the source of truth, and a
 * reader that misses the stream reads it as before.
 */
export type TurnStreamEvent =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'reset' }
  | { readonly type: 'end' };

type Listener = (event: TurnStreamEvent) => void;

interface Entry {
  text: string;
  readonly listeners: Set<Listener>;
}

export class TurnStreamHub {
  private readonly entries = new Map<string, Entry>();

  /** The turn starts generating: readers may subscribe from now on. */
  begin(id: string): void {
    if (!this.entries.has(id)) this.entries.set(id, { text: '', listeners: new Set() });
  }

  /** The whole message so far; a text that does not continue the previous one resets it. */
  publish(id: string, text: string): void {
    const entry = this.entries.get(id);
    if (!entry || text === entry.text) return;
    if (text.startsWith(entry.text)) {
      emit(entry, { type: 'delta', text: text.slice(entry.text.length) });
    } else {
      emit(entry, { type: 'reset' });
      if (text) emit(entry, { type: 'delta', text });
    }
    entry.text = text;
  }

  end(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    emit(entry, { type: 'end' });
  }

  /** `undefined` when the turn is not generating here: the reader falls back to the result. */
  subscribe(id: string, listener: Listener): { text: string; unsubscribe: () => void } | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    entry.listeners.add(listener);
    return { text: entry.text, unsubscribe: () => entry.listeners.delete(listener) };
  }
}

function emit(entry: Entry, event: TurnStreamEvent): void {
  for (const listener of [...entry.listeners]) listener(event);
}

const hubs = new WeakMap<object, TurnStreamHub>();

/** One hub per app instance (keyed by its route deps), like the set of active turns. */
export function turnStreamHub(owner: object): TurnStreamHub {
  const existing = hubs.get(owner);
  if (existing) return existing;
  const created = new TurnStreamHub();
  hubs.set(owner, created);
  return created;
}

export function turnStreamId(candidateId: string, key: string): string {
  return `${candidateId}:${key}`;
}
