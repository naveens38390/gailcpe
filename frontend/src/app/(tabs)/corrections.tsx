import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { api, type Correction, type CorrectionActor } from "../../services/api";
import { Field, Input, PrimaryButton, Suggestions, useSuggestions } from "../../components/inputs";
import { rupees, theme } from "../../theme";
import { Card, Empty, ErrorNote, Loading, Pill, SectionTitle } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";
import type { ThemeColors } from "../../constants/colors";

const statusColor = (c: ThemeColors): Record<string, string> => ({
  pending: c.warning,
  applied: c.success,
  rejected: c.danger,
  approved: c.success,
  changes_requested: c.primary,
});

/** The raw status is a database value; "CHANGES_REQUESTED" is not a caption. */
const STATUS_LABEL: Record<string, string> = {
  pending: "AWAITING APPROVAL",
  applied: "APPROVED",
  rejected: "REJECTED",
  approved: "APPROVED",
  changes_requested: "REVISION REQUESTED",
};

/**
 * Price Corrections — a fast, single-cell fix to one of GAIL's own prices.
 *
 * Deliberately lighter-weight than the Master Data modules (Producers,
 * Locations, Grades, Discounts): those are structured entities on the full
 * Draft -> Review -> Approved -> Published engine with history and rollback.
 * A price correction is one number with a reason, decided once.
 *
 * This screen proposes and tracks; it does not decide. Approving, rejecting
 * and commenting live in the Admin Panel behind the administrator gate — the
 * officer raising a correction should not be able to wave it through from the
 * same screen they raised it on.
 */
export default function CorrectionsScreen() {
  const styles = useStyles();
  const [items, setItems] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const pending = items.filter((c) => c.status === "pending");
  // Sent back for revision: not decided, and the only state that needs the
  // proposer to do something, so it does not belong in either other bucket.
  const revising = items.filter((c) => c.status === "changes_requested");
  const decided = items.filter(
    (c) => c.status !== "pending" && c.status !== "changes_requested",
  );

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
          <SectionTitle>Awaiting approval ({pending.length})</SectionTitle>
          <Text style={styles.readOnlyNote}>
            An administrator reviews these in the Admin Panel. The outcome and
            any comment appear here once it is decided.
          </Text>
          {pending.map((c) => (
            <CorrectionRow key={c._id} correction={c} />
          ))}
        </Card>
      ) : null}

      {!loading && revising.length ? (
        <Card>
          <SectionTitle>Revision requested ({revising.length})</SectionTitle>
          <Text style={styles.readOnlyNote}>
            Sent back with a comment. Submit a fresh correction with the change
            the reviewer asked for.
          </Text>
          {revising.map((c) => (
            <CorrectionRow key={c._id} correction={c} />
          ))}
        </Card>
      ) : null}

      {!loading && decided.length ? (
        <Card>
          <SectionTitle>Decided</SectionTitle>
          {decided.map((c) => (
            <CorrectionRow key={c._id} correction={c} />
          ))}
        </Card>
      ) : null}

      {!loading && !items.length ? (
        <Empty>No price corrections proposed yet.</Empty>
      ) : null}
    </ScrollView>
  );
}

/** Same as the master-data list: a removed account populates as null, not absent. */
function actorLabel(actor: CorrectionActor | string | null | undefined): string {
  if (!actor) return "an account since removed";
  if (typeof actor === "string") return actor;
  return actor.role ? `${actor.name} (${actor.role})` : actor.name;
}

function ProposeForm({ onProposed }: { onProposed: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [grade, setGrade] = useState("");
  const [location, setLocation] = useState("");
  const [proposedPrice, setProposedPrice] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gradeHits = useSuggestions(grade, "grade");
  const locationHits = useSuggestions(location, "location");

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
          placeholderTextColor={colors.textFaint}
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

/** Read-only throughout: every decision control lives in the Admin Panel. */
function CorrectionRow({ correction }: { correction: Correction }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const delta = correction.proposedPrice - correction.currentPrice;
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowGrade}>
          {correction.grade} · {correction.zone}
        </Text>
        <Pill
          label={STATUS_LABEL[correction.status] ?? correction.status.toUpperCase()}
          color={statusColor(colors)[correction.status] ?? colors.neutral}
        />
      </View>

      <View style={styles.priceLine}>
        <Text style={styles.priceOld}>{rupees(correction.currentPrice)}</Text>
        <Text style={styles.priceArrow}>→</Text>
        <Text style={styles.priceNew}>{rupees(correction.proposedPrice)}</Text>
        <Text style={[styles.priceDelta, { color: delta < 0 ? colors.success : colors.danger }]}>
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
          {(STATUS_LABEL[correction.status] ?? correction.status).toLowerCase()} by{" "}
          {actorLabel(correction.decidedBy)}
          {correction.decisionNote ? ` — ${correction.decisionNote}` : ""}
        </Text>
      ) : null}

    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  readOnlyNote: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
  textarea: {
    backgroundColor: c.surfaceCard,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.md,
    color: c.textPrimary,
    padding: theme.space(3),
    fontSize: 14,
    minHeight: 72,
    textAlignVertical: "top",
  },
  row: {
    paddingVertical: theme.space(3),
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowGrade: { color: c.textPrimary, fontSize: 14, fontWeight: "700" },
  priceLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(2),
    marginTop: theme.space(2),
  },
  priceOld: { color: c.textFaint, fontSize: 13, textDecorationLine: "line-through" },
  priceArrow: { color: c.textFaint, fontSize: 13 },
  priceNew: { color: c.textPrimary, fontSize: 15, fontWeight: "800" },
  priceDelta: { fontSize: 12, fontWeight: "700" },
  reason: { color: c.textMuted, fontSize: 13, lineHeight: 18, marginTop: theme.space(1) },
  meta: { color: c.textFaint, fontSize: 11, marginTop: 2 },
}));
