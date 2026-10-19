import { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import { BulkLlmClient } from './bulkLlmClient';
import { readBulkLlmConfig } from './bulkLlmConfig';
export function createBulkLlmRuntime(options: {
  databasePath: string;
  env?: NodeJS.ProcessEnv;
  transport?: typeof fetch;
  delay?: (ms: number) => Promise<void>;
}) {
  const config = readBulkLlmConfig(options.env);
  const ledger = new SqliteBulkLlmLedger(options.databasePath);
  return {
    client: config ? new BulkLlmClient(config, ledger, options.transport, options.delay) : null,
    ledger,
    status: () => ledger.status(config),
    close: () => ledger.close(),
  };
}
export type BulkLlmRuntime = ReturnType<typeof createBulkLlmRuntime>;
