/**
 * Shared behaviour for every master-data module. list/history/pending/submit/
 * review/publish/rollback/diff all delegate to one RevisionWorkflow instance
 * — a subclass supplies that instance (built from its own two Mongoose
 * models) and, only if publishing this entity should force the pricing
 * engine to reload, overrides `invalidate()`.
 *
 * What is deliberately NOT here: `create`/`draft`, because those are the one
 * place each entity genuinely differs — a Producer's fields are not a
 * Location's fields, and folding that into a generic signature would trade
 * real type safety for a few saved lines.
 */

import { Inject } from "@nestjs/common";

import { AuditLogService } from "../audit-log/audit-log.service";
import { RevisionWorkflow } from "./revision-workflow";

/** What actually changed, from a revision's own baseline/fields already in
 * memory — no extra query needed to describe a publish. */
function fieldDelta(baseline: Record<string, unknown> | null | undefined, fields: Record<string, unknown>) {
  const previous: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) {
    previous[key] = baseline?.[key];
    next[key] = fields[key];
  }
  return { previous, next };
}

export abstract class MasterDataService {
  protected abstract workflow: RevisionWorkflow;
  /** e.g. "producer" — labels every audit-log entry this base class writes. */
  protected abstract entityName: string;

  @Inject(AuditLogService)
  protected auditLog!: AuditLogService;

  list() {
    return this.workflow.liveList();
  }

  history(entityId: string) {
    return this.workflow.history(entityId);
  }

  pending() {
    return this.workflow.pending();
  }

  async submit(revisionId: string, userId: string) {
    const rev = await this.workflow.submit(revisionId, userId);
    await this.auditLog.log(userId, `${this.entityName}.submit`, this.entityName, rev.entityId, {
      version: rev.version,
    });
    return rev;
  }

  async review(revisionId: string, userId: string, approve: boolean, note?: string) {
    const rev = await this.workflow.review(revisionId, userId, approve, note);
    await this.auditLog.log(userId, `${this.entityName}.review`, this.entityName, rev.entityId, {
      version: rev.version,
      approved: approve,
      note,
    });
    return rev;
  }

  async publish(revisionId: string, userId: string) {
    const rev = await this.workflow.publish(revisionId, userId);
    this.invalidate();
    const { previous, next } = fieldDelta(rev.baseline, rev.fields);
    await this.auditLog.log(userId, `${this.entityName}.publish`, this.entityName, rev.entityId, {
      version: rev.version,
      previous,
      next,
    });
    return rev;
  }

  async rollback(entityId: string, toVersion: number, userId: string, reason: string) {
    const rev = await this.workflow.rollback(entityId, toVersion, userId, reason);
    this.invalidate();
    await this.auditLog.log(userId, `${this.entityName}.rollback`, this.entityName, entityId, {
      restoredToVersion: toVersion,
      reason,
    });
    return rev;
  }

  diff(entityId: string, fromVersion: number, toVersion: number) {
    return this.workflow.diff(entityId, fromVersion, toVersion);
  }

  /** Override when publishing this entity changes what the pricing engine reads. */
  protected invalidate(): void {}
}
