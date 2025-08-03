import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createDb } from './src/db';
import * as schema from './src/db/schema';
import { bearer } from 'better-auth/plugins';

export function createAuth(env: CloudflareBindings) {
  const db = createDb(env.DATABASE_URL);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        ...schema,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      maxPasswordLength: 10,
      minPasswordLength: 3,
    },
    plugins: [bearer()],
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
  });
}
