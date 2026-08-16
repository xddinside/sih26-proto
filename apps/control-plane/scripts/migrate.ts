/**
 * Apply the schema to the configured database. Idempotent: `db/init.sql` uses
 * `create table if not exists`. Run `bun run migrate` (or `scripts/db.sh start`
 * for the local Docker PostgreSQL).
 */
import { loadConfig } from "../src/config.js"
import { openStore } from "../src/store/store.js"

const config = loadConfig()
const store = await openStore(config)
console.log(`[migrate] applied schema to ${config.databaseUrl}`)
await store.close()
