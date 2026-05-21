import 'dotenv/config';
import { z } from 'zod';

const nonEmptyTrimmed = z.string().transform((value) => value.trim()).pipe(z.string().min(1));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  SUPABASE_URL: nonEmptyTrimmed,
  SUPABASE_SERVICE_ROLE_KEY: nonEmptyTrimmed,

  // Approval thresholds (amounts are numeric in DB as DECIMAL, treat as JS number after parsing)
  HIGH_VALUE_THRESHOLD: z.coerce.number().positive().default(100000),

  // Storage bucket names (create buckets in Supabase manually)
  SUPABASE_STORAGE_BUCKET_DOCUMENTS: z.string().transform((value) => value.trim()).default('pr-documents'),

  // For dev convenience if the frontend hits from a single origin
  CORS_ORIGIN: z.string().transform((value) => value.trim()).optional()
});

export type Env = z.infer<typeof EnvSchema>;

function decodeJwtRole(jwt: string): string | null {
  const parts = jwt.split('.');
  if (parts.length < 2 || !parts[1]) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

const parsedEnv = EnvSchema.parse(process.env);
const serviceRoleClaim = decodeJwtRole(parsedEnv.SUPABASE_SERVICE_ROLE_KEY);

if (serviceRoleClaim !== 'service_role') {
  throw new Error(
    `SUPABASE_SERVICE_ROLE_KEY must be the Supabase service_role JWT. Current JWT role claim: ${
      serviceRoleClaim ?? 'unreadable'
    }. Update the Render environment variable; do not use the anon key for the backend.`,
  );
}

export const env: Env = parsedEnv;
