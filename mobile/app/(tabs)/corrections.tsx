import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { api, type Correction, type CorrectionActor } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Field, Input, PrimaryButton, Suggestions, useSuggestions } from "../../lib/inputs";
import { rupees, theme } from "../../lib/theme";
import { Card, Empty, ErrorNote, Loading, Pill, SectionTitle } from "../../lib/ui";

const APPROVERS = ["corporate_pricing", "admin"];

const STATUS_COLOR: Record<string, string> = {
  pending: theme.color.matched,
  applied: theme.color.leading,
  rejected: theme.color.behind,
  approved: theme.color.leading,
};

/**
 * Price Corrections — a fast, single-cell fix to one of GAIL's own prices.
 *
 * Deliberately lighter-weight than the Master Data modules (Producers,
 * Locations, Grades, Discounts): those are structured entities on the full
 * Draft -> Review -> Approved -> Published engine with history and rollback.
 * A price correction is one number with a reason, decided once — propose and
 * decide are still separate roles, because a correction is a commercial
 * decision and the person asking should not be the person granting it.
 */
export default function CorrectionsScreen() {
  const { user } = useAuth();
  const canDecide = APPROVERS.includes(user?.role ?? "");

  const [items, setItems] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.corrections());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load corrections.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, approve: boolean) {
    setBusyId(id);
    try {
      await api.decideCorrection(id, approve);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record that decision.");
    } finally {
      setBusyId(null);
    }
  }

  const pending = items.filter((c) => c.status === "pending");
  const decided = items.filter((c) => c.status !== "pending");

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <ProposeForm onProposed={load} />

      {error ? <ErrorNote message={error} /> : null}
      {loading ? <Loading label="Loading corrections" /> : null}

      {!loading && pending.length ? (
        <Card>
          <SectionTitle>Pending ({pending.length})</SectionTitle>
          {pending.map((c) => (
            <CorrectionRow
              key={c._id}
              correction={c}
              canDecide={canDecide && actorId(c.proposedBy) !== user?.id}
              busy={busyId === c._id}
              onDecide={(approve) => decide(c._id, approve)}
            />
          ))}
        </Card>
      ) : null}

      {!loading && decided.length ? (
        <Card>
          <SectionTitle>Decided</SectionTitle>
          {decided.map((c) => (
            <CorrectionRow key={c._id} correction={c} canDecide={false} />
          ))}
        </Card>
      ) : null}

      {!loading && !items.length ? (
        <Empty>No price corrections proposed yet.</Empty>
      ) : null}
    </ScrollView>
  );
}

function actorId(actor: CorrectionActor | string): string {
  return typeof actor === "string" ? actor : actor._id;
}

function actorLabel(actor: CorrectionActor | string): string {
  return typeof actor === "string" ? actor : `${actor.name} (${actor.role})`;
}

function ProposeForm({ onProposed }: { onProposed: () => void }) {
  const { user } = useAuth();
  const canPropose = ["territory_manager", "regional_manager", "corporate_pricing", "admin"].includes(
    user?.role ?? "",
  );

  const [grade, setGrade] = useState("");
  const [location, setLocation] = useState("");
  const [proposedPrice, setProposedPrice] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gradeHits = useSuggestions(grade, "grade");
  const locationHits = useSuggestions(location, "location");

  if (!canPropose) {
    return (
      <Card>
        <SectionTitle>Corrections</SectionTitle>
        <Text style={styles.readOnlyNote}>
          Your role can view corrections but not propose one. A territory
          manager or above can ask for a price to be corrected.
        </Text>
      </Card>
    );
  }

  async function submit() {
    setError(null);
    const price = Number(proposedPrice);
    if (!grade.trim() || !location.trim() || !price || reason.trim().length < 10) {
      setError("Fill in grade, location, a proposed price, and a reason of at least 10 characters.");
      return;
    }
    setBusy(true);
    try {
      await api.proposeCorrection({
        grade: grade.trim(),
        location: location.trim(),
        proposedPrice: price,
        reason: reason.trim(),
      });
      setGrade("");
      setLocation("");
      setProposedPrice("");
      setReason("");
      onProposed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit that correction.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionTitle>Propose a correction</SectionTitle>

      <Field label="Grade">
        <Input value={grade} onChangeText={setGrade} autoCapitalize="characters" placeholder="B52A003" />
        <Suggestions items={gradeHits} onPick={setGrade} />
      </Field>

      <Field label="Location">
        <Input
          value={location}
          onChangeText={setLocation}
          autoCapitalize="characters"
          placeholder="PUNE"
        />
        <Suggestions items={locationHits} onPick={setLocation} />
      </Field>

      <Field label="Proposed basic price (Rs/MT)">
        <Input
          value={proposedPrice}
          onChangeText={setProposedPrice}
          keyboardType="numeric"
          placeholder="137500"
        />
      </Field>

      <Field label="Reason" hint="Why — the competitor and gap this is closing">
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="e.g. IOCL is Rs 814/MT cheaper at this zone on 012DB54"
          placeholderTextColor={theme.color.textFaint}
          multiline
          numberOfLines={3}
          style={styles.textarea}
        />
      </Field>

      {error ? <ErrorNote message={error} /> : null}

      <PrimaryButton label="Submit for approval" onPress={submit} busy={busy} />
    </Card>
  );
}

function CorrectionRow({
  correction,
  canDecide,
  busy,
  onDecide,
}: {
  correction: Correction;
  canDecide: boolean;
  busy?: boolean;
  onDecide?: (approve: boolean) => void;
}) {
  const delta = correction.proposedPrice - correction.currentPrice;
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowGrade}>
          {correction.grade} · {correction.zone}
        </Text>
        <Pill
          label={correction.status.toUpperCase()}
          color={STATUS_COLOR[correction.status] ?? theme.color.unknown}
        />
      </View>

      <View style={styles.priceLine}>
        <Text style={styles.priceOld}>{rupees(correction.currentPrice)}</Text>
        <Text style={styles.priceArrow}>→</Text>
        <Text style={styles.priceNew}>{rupees(correction.proposedPrice)}</Text>
        <Text style={[styles.priceDelta, { color: delta < 0 ? theme.color.leading : theme.color.behind }]}>
          ({delta > 0 ? "+" : ""}
          {rupees(delta)})
        </Text>
      </View>

      <Text style={styles.reason}>{correction.reason}</Text>
      <Text style={styles.meta}>
        proposed by {actorLabel(correction.proposedBy)} ·{" "}
        {new Date(correction.createdAt).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
        })}
      </Text>
      {correction.decidedBy ? (
        <Text style={styles.meta}>
          {correction.status} by {actorLabel(correction.decidedBy)}
          {correction.decisionNote ? ` — ${correction.decisionNote}` : ""}
        </Text>
      ) : null}

      {canDecide && onDecide ? (
        <View style={styles.actions}>
          <Pressable
            style={[styles.actionButton, styles.reject, busy && styles.busy]}
            onPress={() => onDecide(false)}
            disabled={busy}
          >
            <Text style={styles.rejectText}>Reject</Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, styles.approve, busy && styles.busy]}
            onPress={() => onDecide(true)}
            disabled={busy}
          >
            <Text style={styles.approveText}>Approve</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  readOnlyNote: { color: theme.color.textMuted, fontSize: 13, lineHeight: 19 },
  textarea: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    color: theme.color.text,
    padding: theme.space(3),
    fontSize: 14,
    minHeight: 72,
    textAlignVertical: "top",
  },
  row: {
    paddingVertical: theme.space(3),
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowGrade: { color: theme.color.text, fontSize: 14, fontWeight: "700" },
  priceLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(2),
    marginTop: theme.space(2),
  },
  priceOld: { color: theme.color.textFaint, fontSize: 13, textDecorationLine: "line-through" },
  priceArrow: { color: theme.color.textFaint, fontSize: 13 },
  priceNew: { color: theme.color.text, fontSize: 15, fontWeight: "800" },
  priceDelta: { fontSize: 12, fontWeight: "700" },
  reason: { color: theme.color.textMuted, fontSize: 13, lineHeight: 18, marginTop: theme.space(1) },
  meta: { color: theme.color.textFaint, fontSize: 11, marginTop: 2 },
  actions: { flexDirection: "row", gap: theme.space(2), marginTop: theme.space(3) },
  actionButton: {
    flex: 1,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(2),
    alignItems: "center",
    borderWidth: 1,
  },
  busy: { opacity: 0.5 },
  reject: { borderColor: theme.color.behind, backgroundColor: theme.color.surfaceAlt },
  rejectText: { color: theme.color.behind, fontWeight: "700", fontSize: 13 },
  approve: { borderColor: theme.color.leading, backgroundColor: theme.color.leading },
  approveText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
});
