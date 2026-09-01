# database (root placeholder) — see packages/database

M07-C is implemented in **`packages/database`** (`@runner-os/database`):
PostgreSQL + Drizzle implementations of the `@runner-os/core` repository ports,
with row↔domain mapping, an atomic DB-authoritative `createActive` (partial
unique index), and `createPgDependencies()` to wire the core services onto
Postgres.

The authoritative schema DDL is **`../migrations/0001_init.sql`** (tables,
partial-unique active-Daily index, CHECK constraints for the ratified scales,
immutability trigger for created_at + plan snapshots, append-only AuditLog
trigger). Integration tests run against real Postgres via pglite
(`packages/database/tests/integration.test.ts`).

Production (M07-D) builds the same Drizzle client over node-postgres/Neon and
applies the same migration.
