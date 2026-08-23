/**
 * Shared UI for every master-data module: the pending-revision queue and the
 * per-entity version history, including rollback. Producers uses this today;
 * Locations, Grades and everything after follow the same Draft -> Review ->
 * Approved -> Published shape, so this is written once here instead of once
 * per screen.
 */

import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { api, type CorrectionActor, type DiffResult, type Revision } from "../services/api";
import { Field, Input, PrimaryButton } from "./inputs";
import { theme } from "../theme";
import { Empty, ErrorNote, Pill } from "./ui";
import { makeStyles, useTheme } from "../context/theme";
import type { ThemeColors } from "../constants/colors";

export const revisionStatusColor = (c: ThemeColors): Record<string, string> => ({
  draft: c.textFaint,
  review: c.warning,
  approved: c.primary,
  published: c.success,
  rejected: c.danger,
  superseded: c.textFaint,
});

/**
 * Who did this, when the record still knows.
 *
 * Mongoose populates a reference to an account that no longer exists as null,
 * not as a missing field — so `typeof actor === "object"` is true and reading
 * `.name` throws. History outlives accounts, so this is a normal state, not an
 * error: the entry stays, the name becomes unknown.
 */
export function actorLabel(a: CorrectionActor | string | null | undefined): string {
  if (!a) return "an account since removed";
  if (typeof a === "string") return a;
  return a.role ? `${a.name} (${a.role})` : a.name;
}

/** Default rendering for a changed field: "key: value". Pass `renderFields` to customise. */
function defaultRenderFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

interface RevisionActions {
  submit: (id: string) => Promise<unknown>;
  review: (id: string, approve: boolean, note?: string) => Promise<unknown>;
  publish: (id: string) => Promise<unknown>;
}

export function PendingRevisionRow({
  rev,
  canReview,
  canPublish,
  busy,
  actions,
  onDone,
  onError,
  renderFields = defaultRenderFields,
}: {
  rev: Revision;
  canReview: boolean;
  canPublish: boolean;
  busy: boolean;
  actions: RevisionActions;
  onDone: () => void;
  onError: (message: string) => void;
  renderFields?: (fields: Record<string, unknown>) => string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : "That action failed.");
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle}>
          {rev.entityId} {rev.createsNew ? "(new)" : ""} · v{rev.version}
        </Text>
        <Pill label={rev.status.toUpperCase()} color={revisionStatusColor(colors)[rev.status] ?? colors.neutral} />
      </View>
      <Text style={styles.rowMeta}>{renderFields(rev.fields)}</Text>
      <Text style={styles.rowMeta}>{rev.reason}</Text>
      <Text style={styles.rowFaint}>proposed by {actorLabel(rev.createdBy)}</Text>

      {rev.status === "draft" ? (
        <View style={styles.rowActions}>
          <Pressable onPress={() => run(() => actions.submit(rev._id))} disabled={busy}>
            <Text style={styles.link}>Submit for review</Text>
          </Pressable>
        </View>
      ) : null}
      {rev.status === "review" && canReview ? (
        <View style={styles.rowActions}>
          <Pressable onPress={() => run(() => actions.review(rev._id, false))} disabled={busy}>
            <Text style={[styles.link, styles.rejectLink]}>Reject</Text>
          </Pressable>
          <Pressable onPress={() => run(() => actions.review(rev._id, true))} disabled={busy}>
            <Text style={styles.link}>Approve</Text>
          </Pressable>
        </View>
      ) : null}
      {rev.status === "approved" && canPublish ? (
        <View style={styles.rowActions}>
          <Pressable onPress={() => run(() => actions.publish(rev._id))} disabled={busy}>
            <Text style={styles.link}>Publish</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function RevisionHistory({
  revisions,
  canPublish,
  onRollback,
  onDiff,
  error,
}: {
  revisions: Revision[];
  canPublish: boolean;
  onRollback: (version: number, reason: string) => Promise<unknown>;
  /** Omit to hide version comparison — not every caller has a diff endpoint wired up yet. */
  onDiff?: (from: number, to: number) => Promise<DiffResult>;
  error?: string | null;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [reason, setReason] = useState("");
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [compareA, setCompareA] = useState<number | null>(null);
  const [compareB, setCompareB] = useState<number | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  async function toggleCompare(version: number) {
    if (!onDiff) return;
    setDiff(null);
    if (compareA === version) {
      setCompareA(null);
      return;
    }
    if (compareB === version) {
      setCompareB(null);
      return;
    }
    if (compareA === null) {
      setCompareA(version);
      return;
    }
    if (compareB === null) {
      setCompareB(version);
      setDiffLoading(true);
      try {
        const from = Math.min(compareA, version);
        const to = Math.max(compareA, version);
        setDiff(await onDiff(from, to));
      } catch (e) {
        setLocalError(e instanceof Error ? e.message : "Could not load that comparison.");
      } finally {
        setDiffLoading(false);
      }
      return;
    }
    // Both already picked — start a fresh comparison with this version.
    setCompareA(version);
    setCompareB(null);
  }

  async function restore(version: number) {
    if (reason.trim().length < 10) {
      setLocalError("Give a reason (10+ characters) before restoring a version.");
      return;
    }
    setBusyVersion(version);
    setLocalError(null);
    try {
      await onRollback(version, reason.trim());
      setReason("");
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Rollback failed.");
    } finally {
      setBusyVersion(null);
    }
  }

  if (!revisions.length) return <Empty>No revisions yet.</Empty>;
  return (
    <View style={styles.history}>
      {(error ?? localError) ? <ErrorNote message={(error ?? localError)!} /> : null}
      {onDiff && revisions.length > 1 ? (
        <Text style={styles.compareHint}>
          {compareA === null ? "Tap two versions to compare them" : "Tap a second version to compare"}
        </Text>
      ) : null}
      {revisions.map((rev) => {
        const picked = compareA === rev.version || compareB === rev.version;
        return (
          <View key={rev._id} style={styles.historyRow}>
            <Pressable
              style={styles.rowHead}
              onPress={onDiff ? () => toggleCompare(rev.version) : undefined}
              disabled={!onDiff}
            >
              <View style={styles.versionLabel}>
                {onDiff ? (
                  <View style={[styles.checkbox, picked && styles.checkboxChecked]}>
                    {picked ? <Text style={styles.checkboxMark}>✓</Text> : null}
                  </View>
                ) : null}
                <Text style={styles.rowTitle}>v{rev.version}</Text>
              </View>
              <Pill label={rev.status.toUpperCase()} color={revisionStatusColor(colors)[rev.status] ?? colors.neutral} />
            </Pressable>
            <Text style={styles.rowFaint}>
              {actorLabel(rev.createdBy)} · {new Date(rev.createdAt).toLocaleDateString("en-IN")}
              {rev.publishedBy ? ` · published by ${actorLabel(rev.publishedBy)}` : ""}
            </Text>
            {(rev.status === "published" || rev.status === "superseded") && canPublish ? (
              <Pressable onPress={() => restore(rev.version)} disabled={busyVersion === rev.version}>
                <Text style={styles.link}>Restore this version</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {diffLoading ? <Text style={styles.rowFaint}>Comparing…</Text> : null}
      {diff ? (
        <View style={styles.diffBox}>
          <Text style={styles.diffTitle}>
            v{diff.fromVersion} → v{diff.toVersion}
          </Text>
          {diff.changes.length ? (
            diff.changes.map((c) => (
              <View key={c.field} style={styles.diffRow}>
                <Text style={styles.diffField}>{c.field}</Text>
                <View style={styles.diffValues}>
                  <Text style={styles.diffFrom}>{formatDiffValue(c.from)}</Text>
                  <Text style={styles.diffArrow}>→</Text>
                  <Text style={styles.diffTo}>{formatDiffValue(c.to)}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.rowFaint}>No field-level differences between these versions.</Text>
          )}
        </View>
      ) : null}

      {canPublish ? (
        <Field label="Rollback reason" hint="Required before restoring any version above">
          <Input value={reason} onChangeText={setReason} placeholder="Why roll back" />
        </Field>
      ) : null}
    </View>
  );
}

function formatDiffValue(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const useStyles = makeStyles((c) => ({
  row: { paddingVertical: theme.space(3), borderTopWidth: 1, borderTopColor: c.border },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowTitle: { color: c.textPrimary, fontSize: 14, fontWeight: "700" },
  rowMeta: { color: c.textMuted, fontSize: 12, marginTop: 2 },
  rowFaint: { color: c.textFaint, fontSize: 11, marginTop: 2 },
  rowActions: { flexDirection: "row", gap: theme.space(4), marginTop: theme.space(2) },
  link: { color: c.primary, fontSize: 12, fontWeight: "700" },
  rejectLink: { color: c.danger },
  history: {
    marginTop: theme.space(2),
    backgroundColor: c.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: theme.space(3),
  },
  compareHint: { color: c.textFaint, fontSize: 11, fontStyle: "italic", marginBottom: theme.space(1) },
  versionLabel: { flexDirection: "row", alignItems: "center", gap: theme.space(2) },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { backgroundColor: c.primary, borderColor: c.primary },
  checkboxMark: { color: c.onPrimary, fontSize: 11, fontWeight: "700" },
  diffBox: {
    marginTop: theme.space(2),
    backgroundColor: c.surfaceCard,
    borderRadius: theme.radius.sm,
    padding: theme.space(3),
    borderWidth: 1,
    borderColor: c.border,
  },
  diffTitle: { color: c.textMuted, fontSize: 11, fontWeight: "700", marginBottom: theme.space(1) },
  diffRow: { paddingVertical: 3 },
  diffField: { color: c.textMuted, fontSize: 11, fontWeight: "700" },
  diffValues: { flexDirection: "row", alignItems: "center", gap: theme.space(2), marginTop: 1 },
  diffFrom: { color: c.danger, fontSize: 12, textDecorationLine: "line-through" },
  diffArrow: { color: c.textFaint, fontSize: 12 },
  diffTo: { color: c.success, fontSize: 12, fontWeight: "700" },
  historyRow: { paddingVertical: theme.space(2), borderTopWidth: 1, borderTopColor: c.border },
}));
