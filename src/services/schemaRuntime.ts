import { z } from 'zod';

// Must run before App imports and initializes schemas. Zod's eval capability
// probe otherwise triggers a CSP violation even though it catches the rejection.
z.config({ jitless: true });
