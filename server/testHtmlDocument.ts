import { createRequire } from 'node:module';

// jsdom is an existing untyped dev dependency; keep the harness surface explicit.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string) => { window: { document: Document } };
};

export function parseTestDocument(html: string): Document {
  return new JSDOM(html).window.document;
}
