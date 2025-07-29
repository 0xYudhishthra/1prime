import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Create database connection using environment variables from Cloudflare Workers context
export function createDb(databaseUrl: string) {
	const client = postgres(databaseUrl, {
		prepare: false,
	});
	return drizzle({ client });
}
