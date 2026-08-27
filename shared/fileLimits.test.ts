import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_MAX_BYTES, LOCAL_PDF_MAX_BYTES, megabytes } from './fileLimits';

describe('fileLimits', () => {
  it('converts byte limits to megabytes', () => {
    expect(megabytes(DOCUMENT_MAX_BYTES)).toBe(5);
    expect(megabytes(LOCAL_PDF_MAX_BYTES)).toBe(20);
  });

  it('matches database document storage limit in sqliteSchema.ts', () => {
    const schemaPath = path.resolve(__dirname, '../server/data/sqliteSchema.ts');
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    expect(schemaContent).toContain(`byte_size > 0 AND byte_size <= ${DOCUMENT_MAX_BYTES}`);
  });
});
