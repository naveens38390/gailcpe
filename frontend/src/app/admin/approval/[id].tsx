import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { api, type Correction } from "../../../services/api";
import { actorLabel, correctionStatusColor } from "../../../components/masterData";
import { PrimaryButton } from "../../../components/inputs";
import { rupees, theme } from "../../../theme";
import { Card, ErrorNote, Loading, Pill, SectionTitle } from "../../../components/ui";
import { makeStyles, useTheme } from "../../../context/theme";

type Action = "approve" | "reject" | "changes" | null;

/**
 * One correction, in full: current vs proposed, the reason, the whole
 * timeline, and the decision itself — confirmed explicitly rather than
 * decided with a single stray tap.
 */
export default function ApprovalDetailScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [correction, setCorrection] = useState<Correction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCorrection(await api.correctionDetail(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this correction.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirm() {
    if (!correction) return;
    if (action === "changes" && note.trim().length < 5) {
      setError("Explain what needs to change (at least 5 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (action === "approve") await api.decideCorrection(correction._id, true, note.trim() || undefined);
      if (action === "reject") await api.decideCorrection(correction._id, false, note.trim() || undefined);
      if (action === "changes") await api.requestCorrectionChanges(correction._id, note.trim());
      setAction(null);
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That decision could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !correction) return <Loading label="Loading correction" />;

  const delta = correction.proposedPrice - correction.currentPrice;
  const canDecide = correction.status === "pending";

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      {error ? <ErrorNote message={error} /> : null}

      <Card>
        <View style={styles.headRow}>
          <Text style={styles.title}>
            {correction.grade} · {correction.zone}
          </Text>
          <Pill
            label={correction.status.replace("_", " ").toUpperCase()}
            color={correctionStatusColor(colors)[correction.status] ?? colors.neutral}
          />
        </View>

        <View style={styles.priceCompare}>
          <View style={styles.priceCol}>
            <Text style={styles.priceLabel}>Current</Text>
            <Text style={styles.priceValue}>{rupees(correction.currentPrice)}</Text>
          </View>
          <Text style={styles.arrow}>→</Text>
          <View style={styles.priceCol}>
            <Text style={styles.priceLabel}>Proposed</Text>
            <Text style={styles.priceValue}>{rupees(correction.proposedPrice)}</Text>
          </View>
          <View style={styles.priceCol}>
            <Text style={styles.priceLabel}>Change</Text>
            <Text style={[styles.priceValue, { color: delta < 0 ? colors.success : colors.danger }]}>
              {delta > 0 ? "+" : ""}
              {rupees(delta)}
            </Text>
          </View>
        </View>

        <Text style={styles.reasonLabel}>Reason</Text>
        <Text style={styles.reason}>{correction.reason}</Text>
        <Text style={styles.meta}>
          proposed by {actorLabel(correction.proposedBy)} ·{" "}
          {new Date(correction.createdAt).toLocaleString("en-IN")}
        </Text>
      </Card>

      {correction.events?.length ? (
        <Card>
          <SectionTitle>Timeline</SectionTitle>
          {correction.events.map((ev, i) => (
            <View key={i} style={styles.eventRow}>
              <Text style={styles.eventType}>{ev.type.replace("_", " ")}</Text>
              <Text style={styles.eventMeta}>
                {actorLabel(ev.by)} · {new Date(ev.at).toLocaleString("en-IN")}
              </Text>
              {ev.note ? <Text style={styles.eventNote}>{ev.note}</Text> : null}
            </View>
          ))}
        </Card>
      ) : null}

      {canDecide ? (
        <Card>
          {action ? (
            <View>
              <Text style={styles.confirmTitle}>
                {action === "approve" ? "Approve this correction?" : null}
                {action === "reject" ? "Reject this correction?" : null}
                {action === "changes" ? "What needs to change?" : null}
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={
                  action === "changes"
                    ? "e.g. confirm the zone before this can be approved"
                    : "Optional note"
                }
                placeholderTextColor={colors.textFaint}
                multiline
                numberOfLines={3}
                style={styles.textarea}
              />
              <View style={styles.confirmActions}>
                <Pressable
                  style={styles.cancelButton}
                  onPress={() => {
                    setAction(null);
                    setNote("");
                    setError(null);
                  }}
                  disabled={busy}
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <View style={styles.confirmButton}>
                  <PrimaryButton label="Confirm" onPress={confirm} busy={busy} />
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.actions}>
              <Pressable style={[styles.actionButton, styles.reject]} onPress={() => setAction("reject")}>
                <Text style={styles.rejectText}>Reject</Text>
              </Pressable>
              <Pressable style={[styles.actionButton, styles.changes]} onPress={() => setAction("changes")}>
                <Text style={styles.changesText}>Request changes</Text>
              </Pressable>
              <Pressable style={[styles.actionButton, styles.approve]} onPress={() => setAction("approve")}>
                <Text style={styles.approveText}>Approve</Text>
              </Pressable>
            </View>
          )}
        </Card>
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: c.textPrimary, fontSize: 16, fontWeight: "800" },
  priceCompare: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(3),
    marginTop: theme.space(4),
  },
  priceCol: { flex: 1 },
  priceLabel: { color: c.textFaint, fontSize: 11 },
  priceValue: { color: c.textPrimary, fontSize: 15, fontWeight: "700", marginTop: 2 },
  arrow: { color: c.textFaint, fontSize: 16 },
  reasonLabel: {
    color: c.textFaint,
    fontSize: 11,
    marginTop: theme.space(4),
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingTop: theme.space(3),
  },
  reason: { color: c.textPrimary, fontSize: 13, lineHeight: 19, marginTop: theme.space(1) },
  meta: { color: c.textFaint, fontSize: 11, marginTop: theme.space(2) },
  eventRow: { paddingVertical: theme.space(2), borderTopWidth: 1, borderTopColor: c.border },
  eventType: { color: c.textPrimary, fontSize: 13, fontWeight: "700", textTransform: "capitalize" },
  eventMeta: { color: c.textFaint, fontSize: 11, marginTop: 2 },
  eventNote: { color: c.textMuted, fontSize: 12, marginTop: 2, lineHeight: 17 },
  actions: { flexDirection: "row", gap: theme.space(2) },
  actionButton: {
    flex: 1,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(3),
    alignItems: "center",
    borderWidth: 1,
  },
  reject: { borderColor: c.danger, backgroundColor: c.surfaceAlt },
  rejectText: { color: c.danger, fontWeight: "700", fontSize: 13 },
  changes: { borderColor: c.primary, backgroundColor: c.surfaceAlt },
  changesText: { color: c.primary, fontWeight: "700", fontSize: 13 },
  approve: { borderColor: c.success, backgroundColor: c.success },
  approveText: { color: c.onPrimary, fontWeight: "700", fontSize: 13 },
  confirmTitle: { color: c.textPrimary, fontSize: 14, fontWeight: "700", marginBottom: theme.space(2) },
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
  confirmActions: { flexDirection: "row", gap: theme.space(2), marginTop: theme.space(3), alignItems: "center" },
  cancelButton: { paddingVertical: theme.space(3), paddingHorizontal: theme.space(3) },
  cancelText: { color: c.textMuted, fontWeight: "600", fontSize: 13 },
  confirmButton: { flex: 1 },
}));
