# Runner OS

Personal athletic operating system. Production monorepo (M07-B foundation).

## Layout

```
runner-os/
  packages/
    core/        @runner-os/core — framework-free domain + application services + ports.
                 NO Next.js / React / DOM / Apps Script / Drizzle / Postgres deps.
    shared/      @runner-os/shared — Zod transport/input validation for the API + clients.
  apps/
    web/         Next.js PWA + Route Handler API (M07-D / M07-E).       [placeholder]
  database/      PostgreSQL + Drizzle repository implementations (M07-C). [placeholder]
  migrations/    Drizzle SQL migrations (M07-C).                         [placeholder]
  tests/         Integration / E2E (M07-C+).                            [placeholder]
  legacy-appsscript/  M01–M05 Apps Script implementation — preserved as the
                      Runner OS domain SPECIFICATION + reference (still 78/78).
```

## Architecture (dependency direction)

```
Web / API  →  application services  →  domain/core  →  repository PORTS  ←  infrastructure
```

`packages/core` depends on nothing framework-specific. Services depend on port
interfaces; infrastructure (in-memory now, Postgres/Drizzle in M07-C) implements
them. Frontend talks only to the API. This keeps the core portable across web,
future native clients, and future integrations (audio, AI, Google, NFC) without
a domain rewrite.

## Develop

```bash
npm install
npm test          # Vitest — pure domain/application tests (no database)
npm run typecheck # tsc project references
```

Usable from Claude Code/Cody, VS Code, terminal, and Git. No IDE is part of the
runtime architecture.

## Status

- M01–M05: complete (Apps Script reference, `legacy-appsscript/`, 78/78).
- M07-A: architecture approved (`ARCHITECTURE-M07A.md`).
- M07-B: production core foundation (this) — domain extracted, ports defined,
  Vitest suite. No cloud, no database, no deployment yet.
- Next: M07-C (Postgres/Drizzle) — awaiting approval.
