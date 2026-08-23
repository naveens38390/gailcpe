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

import { RevisionWorkflow } from "./revision-workflow";

export abstract class MasterDataService {
  protected abstract workflow: RevisionWorkflow;

  list() {
    return this.workflow.liveList();
  }

  history(entityId: string) {
    return this.workflow.history(entityId);
  }

  pending() {
    return this.workflow.pending();
  }

  submit(revisionId: string, userId: string) {
    return this.workflow.submit(revisionId, userId);
  }

  review(revisionId: string, userId: string, approve: boolean, note?: string) {
    return this.workflow.review(revisionId, userId, approve, note);
  }

  async publish(revisionId: string, userId: string) {
    const rev = await this.workflow.publish(revisionId, userId);
    this.invalidate();
    return rev;
  }

  async rollback(entityId: string, toVersion: number, userId: string, reason: string) {
    const rev = await this.workflow.rollback(entityId, toVersion, userId, reason);
    this.invalidate();
    return rev;
  }

  diff(entityId: string, fromVersion: number, toVersion: number) {
    return this.workflow.diff(entityId, fromVersion, toVersion);
  }

  /** Override when publishing this entity changes what the pricing engine reads. */
  protected invalidate(): void {}
}
