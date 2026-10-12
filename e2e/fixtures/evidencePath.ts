import { join } from 'node:path';

export function e2eEvidenceDirectory(ticket: string): string {
  return join(process.cwd(), 'test-results', 'evidence', ticket);
}
