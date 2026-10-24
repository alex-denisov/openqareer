import { expect, it } from 'vitest';
import { z } from 'zod';
import './schemaRuntime';

it('uses CSP-compatible validation while preserving success and failure results', () => {
  expect(z.config().jitless).toBe(true);
  const credentials = z.object({ email: z.email(), password: z.string().min(8) });
  expect(credentials.safeParse({ email: 'candidate@example.com', password: 'synthetic-password' }).success).toBe(true);
  expect(credentials.safeParse({ email: 'invalid', password: 'short' }).success).toBe(false);
});
