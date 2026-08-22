import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { api, type LocationHit, type Revision } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { Field, Input, PrimaryButton, Suggestions, useSuggestions } from "../../../lib/inputs";
import { PendingRevisionRow, RevisionHistory } from "../../../lib/masterData";
import { theme } from "../../../lib/theme";
import { Card, Empty, ErrorNote, Loading, SectionTitle } from "../../../lib/ui";

const PROPOSERS = ["territory_manager", "regional_manager", "corporate_pricing", "admin"];
const REVIEWERS = ["regional_manager", "corporate_pricing", "admin"];
const PUBLISHERS = ["corporate_pricing", "admin"];
const COMPETITORS = ["RIL", "IOCL", "HMEL", "OPaL", "HPL"] as const;

/**
 * Location Management — the module the Silvassa/Noida bug directly
 * motivates. A producer's zone name for a town used to only change by
 * editing code (ALIASES/SPELLINGS in etl/locations.py); this makes it
 * editable, audited, versioned data instead — the same fix, without a
 * redeploy.
 */
export default function LocationsScreen() {
  const { user } = useAuth();
  const role = user?.role ?? "";
  const canPropose = PROPOSERS.includes(role);
  const canReview = REVIEWERS.includes(role);
  const canPublish = PUBLISHERS.includes(role);

  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<LocationHit | null>(null);
  const [pending, setPending] = useState<Revision[]>([]);
  const [history, setHistory] = useState<Revision[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const hits = useSuggestions(term, "location");

  const loadPending = useCallback(async () => {
    if (!canReview) return;
    try {
      setPending(await api.locationPending());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load pending changes.");
    }
  }, [canReview]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  async function select(hit: LocationHit) {
    setSelected(hit);
    setTerm("");
    setShowHistory(false);
    setEditing(false);
  }

  async function openHistory() {
    if (!selected) return;
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    try {
      setHistory(await api.locationHistory(selected.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history.");
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {error ? <ErrorNote message={error} /> : null}

      <Card>
        <View style={styles.cardHead}>
          <SectionTitle>Find a location</SectionTitle>
          {canPropose ? (
            <Pressable onPress={() => setCreating((c) => !c)}>
              <Text style={styles.link}>{creating ? "Cancel" : "+ New location"}</Text>
            </Pressable>
          ) : null}
        </View>
        <Field label="Location name">
          <Input value={term} onChangeText={setTerm} autoCapitalize="characters" placeholder="PUNE" />
          <Suggestions items={hits} onPick={(value) => {
            const hit = hits.find((h) => ("name" in h ? h.name : h.gailGrade) === value);
            if (hit && "name" in hit) select(hit);
          }} />
        </Field>
        {creating ? <CreateForm onDone={() => { setCreating(false); loadPending(); }} /> : null}
      </Card>

      {selected ? (
        <Card>
          <View style={styles.cardHead}>
            <SectionTitle>{selected.name}</SectionTitle>
            <View style={styles.rowActions}>
              {canPropose ? (
                <Pressable onPress={() => setEditing((e) => !e)}>
                  <Text style={styles.link}>{editing ? "Cancel" : "Propose edit"}</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={openHistory}>
                <Text style={styles.link}>{showHistory ? "Hide history" : "History"}</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.rowMeta}>
            {Object.keys(selected.producerZone ?? {}).length} producer zone mappings on file
          </Text>
          {Object.entries(selected.producerZone ?? {}).map(([producer, zone]) => (
            <View key={producer} style={styles.zoneRow}>
              <Text style={styles.zoneProducer}>{producer}</Text>
              <Text style={styles.zoneValue}>{zone}</Text>
              <Text style={styles.rowFaint}>{selected.producerZoneTier?.[producer] ?? ""}</Text>
            </View>
          ))}

          {editing ? (
            <EditForm
              locationName={selected.name}
              onDone={() => {
                setEditing(false);
                loadPending();
              }}
            />
          ) : null}

          {showHistory ? (
            <RevisionHistory
              revisions={history}
              canPublish={canPublish}
              onRollback={async (version, reason) => {
                await api.rollbackLocation(selected.name, version, reason);
                setHistory(await api.locationHistory(selected.name));
              }}
              onDiff={(from, to) => api.locationDiff(selected.name, from, to)}
            />
          ) : null}
        </Card>
      ) : null}

      {canReview && pending.length ? (
        <Card>
          <SectionTitle>Pending ({pending.length})</SectionTitle>
          {pending.map((rev) => (
            <PendingRevisionRow
              key={rev._id}
              rev={rev}
              currentUserId={user?.id}
              canReview={canReview}
              canPublish={canPublish}
              busy={busyId === rev._id}
              actions={{
                submit: (id) => api.submitLocationRevision(id),
                review: (id, approve) => api.reviewLocationRevision(id, approve),
                publish: (id) => api.publishLocationRevision(id),
              }}
              onDone={() => {
                setBusyId(null);
                loadPending();
              }}
              onError={setError}
            />
          ))}
        </Card>
      ) : null}

      {!selected && !pending.length && !creating ? (
        <Empty>Search a location to view or edit its producer zone mapping.</Empty>
      ) : null}
    </ScrollView>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || reason.trim().length < 10) {
      setError("Name and a reason of at least 10 characters are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createLocation({ name: name.trim().toUpperCase(), reason: reason.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not propose that location.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Field label="Name"><Input value={name} onChangeText={setName} autoCapitalize="characters" placeholder="e.g. NEW TOWN" /></Field>
      <Field label="Reason"><Input value={reason} onChangeText={setReason} placeholder="Why this location is being added" /></Field>
      {error ? <ErrorNote message={error} /> : null}
      <PrimaryButton label="Submit for review" onPress={submit} busy={busy} />
    </View>
  );
}

function EditForm({ locationName, onDone }: { locationName: string; onDone: () => void }) {
  const [producer, setProducer] = useState<(typeof COMPETITORS)[number]>("RIL");
  const [zone, setZone] = useState("");
  const [patch, setPatch] = useState<Record<string, string | null>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function stage() {
    if (!zone.trim()) return;
    setPatch((p) => ({ ...p, [producer]: zone.trim() }));
    setZone("");
  }
  function stageRemoval(prod: string) {
    setPatch((p) => ({ ...p, [prod]: null }));
  }

  async function submit() {
    if (!Object.keys(patch).length) {
      setError("Stage at least one producer zone change first.");
      return;
    }
    if (reason.trim().length < 10) {
      setError("Reason needs at least 10 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.draftLocation(locationName, { producerZone: patch, reason: reason.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit that change.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Field label="Producer zone mapping">
        <View style={styles.basisRow}>
          {COMPETITORS.map((c) => (
            <Pressable key={c} onPress={() => setProducer(c)} style={[styles.basisOption, producer === c && styles.basisActive]}>
              <Text style={[styles.basisText, producer === c && styles.basisTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.zoneInputRow}>
          <Input
            value={zone}
            onChangeText={setZone}
            placeholder={`${producer}'s zone name for this town`}
            style={styles.zoneInput}
          />
          <Pressable onPress={stage} style={styles.stageButton}><Text style={styles.stageButtonText}>Set</Text></Pressable>
        </View>
      </Field>

      {Object.keys(patch).length ? (
        <View style={styles.stagedList}>
          {Object.entries(patch).map(([prod, val]) => (
            <View key={prod} style={styles.zoneRow}>
              <Text style={styles.zoneProducer}>{prod}</Text>
              <Text style={styles.zoneValue}>{val === null ? "(removed)" : val}</Text>
              <Pressable onPress={() => stageRemoval(prod)}><Text style={styles.removeLink}>remove</Text></Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <Field label="Reason"><Input value={reason} onChangeText={setReason} placeholder="Why this zone changed" /></Field>
      {error ? <ErrorNote message={error} /> : null}
      <PrimaryButton label="Submit for review" onPress={submit} busy={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  body: { padding: theme.space(4), paddingBottom: theme.space(12) },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { color: theme.color.accent, fontSize: 12, fontWeight: "700" },
  rowActions: { flexDirection: "row", gap: theme.space(4) },
  rowMeta: { color: theme.color.textMuted, fontSize: 12, marginTop: theme.space(2), marginBottom: theme.space(1) },
  rowFaint: { color: theme.color.textFaint, fontSize: 10 },
  zoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(2),
    paddingVertical: theme.space(1),
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  zoneProducer: { color: theme.color.textMuted, fontSize: 12, fontWeight: "700", width: 56 },
  zoneValue: { color: theme.color.text, fontSize: 12, flex: 1 },
  removeLink: { color: theme.color.behind, fontSize: 11, fontWeight: "700" },
  form: { marginTop: theme.space(3), gap: theme.space(1) },
  basisRow: { flexDirection: "row", gap: theme.space(2), flexWrap: "wrap" },
  basisOption: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
  },
  basisActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  basisText: { color: theme.color.textMuted, fontSize: 12 },
  basisTextActive: { color: "#FFFFFF", fontWeight: "700" },
  zoneInputRow: { flexDirection: "row", gap: theme.space(2), alignItems: "center", marginTop: theme.space(2) },
  zoneInput: { flex: 1 },
  stageButton: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(3),
  },
  stageButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 12 },
  stagedList: { marginTop: theme.space(2) },
});
