import type { MemoryChange } from '../candidateStore';
import type { MemoryRow } from './shared';

export function memoryStatusAfter(change: MemoryChange): 'confirmed' | 'corrected' | 'deleted' {
  if (change.action === 'confirm') return 'confirmed';
  return change.action === 'correct' ? 'corrected' : 'deleted';
}

export function memoryStatementAfter(change: MemoryChange, currentStatement: string): string {
  if (change.action === 'correct') return change.statement!.trim();
  return change.action === 'delete' ? '[deleted]' : currentStatement;
}

export function memorySourceRefsAfter(change: MemoryChange, row: MemoryRow, now: string): string[] {
  const currentSourceRefs = JSON.parse(row.source_message_ids) as string[];
  const activeSourceRefs = currentSourceRefs.filter(
    (ref) => !ref.startsWith('deleted-document:'),
  );
  return change.action !== 'delete' && activeSourceRefs.length === 0
    ? [`candidate-review:${now}`]
    : activeSourceRefs;
}
