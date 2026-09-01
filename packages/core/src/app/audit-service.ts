/**
 * Append-only audit writer. Builds AuditEntry records (server id + timestamp)
 * and appends via the AuditRepository. Field-level entries for mutations.
 */
import type { AuditRepository, Clock, IdGenerator, UserContext } from '../ports/index.js';
import type { AuditAction, AuditEntry } from '../domain/types.js';

export interface FieldChange {
  readonly field: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

export class AuditService {
  constructor(
    private readonly repo: AuditRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async record(
    ctx: UserContext,
    entityType: 'Daily' | 'Plan',
    entityId: string,
    action: AuditAction,
    changes: readonly FieldChange[],
    reason = '',
  ): Promise<void> {
    if (changes.length === 0) return;
    const ts = this.clock.now().toISOString();
    const entries: AuditEntry[] = changes.map((c) => ({
      id: this.ids.newId(),
      userId: ctx.userId,
      timestamp: ts,
      entityType,
      entityId,
      action,
      fieldChanged: c.field,
      oldValue: str(c.oldValue),
      newValue: str(c.newValue),
      actor: ctx.actor,
      reason,
    }));
    await this.repo.append(entries);
  }
}
