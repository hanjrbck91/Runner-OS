/**
 * @runner-os/core — framework-free Runner OS domain + application layer.
 * No dependency on Next.js, React, browser DOM, Apps Script, Drizzle, or Postgres.
 */

// Result / errors
export * from './result.js';

// Domain
export * from './domain/time.js';
export * from './domain/types.js';
export * from './domain/rules.js';
export * from './domain/plan-resolution.js';
export * from './domain/metrics.js';

// Ports
export * from './ports/index.js';

// Application services
export * from './app/audit-service.js';
export * from './app/daily-service.js';
export * from './app/plan-service.js';
export * from './app/aggregation-service.js';
export * from './app/today-service.js';
export * from './app/report-service.js';
export * from './app/plan-import-service.js';
export * from './app/plan-overview-service.js';
export * from './domain/csv.js';
export * from './domain/plan-csv.js';
export * from './app/services.js';

// Default adapters (system clock + uuid). In-memory adapters are a subpath:
//   import { createInMemoryDependencies } from '@runner-os/core/adapters/memory'
export * from './adapters/system.js';
