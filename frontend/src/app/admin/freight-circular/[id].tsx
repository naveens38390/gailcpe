import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  api,
  type FreightCircularDiff,
  type FreightCircularDraft,
  type FreightCircularRow,
} from "../../../services/api";
import { DataGrid, EditDrawer, SelectionBar } from "../../../components/dataGrid";
import { Field, Input, PrimaryButton } from "../../../components/inputs";
import { revisionStatusColor } from "../../../components/masterData";
import { rupees, theme } from "../../../theme";
import { Card, ErrorNote, Loading, Pill } from "../../../components/ui";
import { makeStyles, useTheme } from "../../../context/theme";

/**
 * One draft freight circular's destinations — the same Data Grid, Edit Drawer
 * and Draft -> Review -> Approved -> Published header the price circular
 * screen uses, so the two are one workflow to learn rather than two.
 *
 * The addition is the unmapped-destination panel. A rate against a town no
 * location maps to will publish and then be reachable by nothing, which is the
 * one failure mode freight has that price does not; the reviewer is shown the
 * full list, and approving requires saying they have seen it.
 */
export default function FreightCircularRowsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [draft, setDraft] = useState<FreightCircularDraft | null>(null);
  const [rows, setRows] = useState<FreightCircularRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FreightCircularRow | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diff, setDiff] = useState<FreightCircularDiff | null>(null);
  const [unmappedOpen, setUnmappedOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([
        api.freightCircularDetail(id),
        api.freightCircularRows(id),
      ]);
      setDraft(d);
      setRows(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this circular.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const canEdit = draft?.status === "draft";

  const filters = useMemo(
    () => [
      { key: "changed", label: "Changed only", predicate: (r: FreightCircularRow) => r.changed },
      { key: "new", label: "New destinations", predicate: (r: FreightCircularRow) => r.isNew },
      { key: "unmapped", label: "Unmapped", predicate: (r: FreightCircularRow) => !r.mapped },
    ],
    [],
  );

  function toggleSelect(rowId: string) {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  const loadDiff = useCallback(async () => {
    try {
      setDiff(await api.freightCircularDiff(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the diff.");
    }
  }, [id]);

  async function openDiff() {
    if (diffOpen) {
      setDiffOpen(false);
      return;
    }
    setDiffOpen(true);
    await loadDiff();
  }

  async function openUnmapped() {
    if (unmappedOpen) {
      setUnmappedOpen(false);
      return;
    }
    setUnmappedOpen(true);
    if (!diff) await loadDiff();
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That action failed.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Approving a circular that carries unmapped destinations requires the
   * reviewer to have opened the list first. The API refuses the approval
   * regardless — this only makes the refusal unnecessary by putting the list
   * in front of them before the button does anything.
   */
  async function approve() {
    if (draft?.unmappedCount && !unmappedOpen) {
      setUnmappedOpen(true);
      if (!diff) await loadDiff();
      setError(
        `This circular has ${draft.unmappedCount} unmapped destination(s). Read the list below, then approve again to confirm you have seen them.`,
      );
      return;
    }
    await act(() => api.reviewFreightCircular(id, true, undefined, true));
  }

  if (loading || !draft) return <Loading label="Loading freight circular" />;

  return (
    <View style={styles.root}>
      {error ? (
        <View style={styles.errorWrap}>
          <ErrorNote message={error} />
        </View>
      ) : null}

      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>
            {draft.producer} · {draft.circularNumber}
          </Text>
          <Pill
            label={draft.status.toUpperCase()}
            color={revisionStatusColor(colors)[draft.status] ?? colors.neutral}
          />
        </View>
        <Text style={styles.subtitle}>
          {draft.rowCount.toLocaleString("en-IN")} destinations ·{" "}
          {draft.changedRowCount.toLocaleString("en-IN")} changed
          {draft.addedRowCount ? ` · ${draft.addedRowCount} added` : ""}
          {draft.removedDestinations?.length ? ` · ${draft.removedDestinations.length} dropped` : ""}
        </Text>

        {draft.unmappedCount ? (
          <Pressable onPress={openUnmapped} style={styles.warnBanner}>
            <Text style={styles.warnText}>
              {draft.unmappedCount} destination{draft.unmappedCount === 1 ? "" : "s"} not mapped to
              any location{draft.unmappedAcknowledgedAt ? " — acknowledged at review" : ""}. These
              rates publish but no comparison can reach them.
            </Text>
            <Text style={styles.warnLink}>{unmappedOpen ? "Hide the list" : "Show the list"}</Text>
          </Pressable>
        ) : null}

        <View style={styles.headerActions}>
          <Pressable onPress={openDiff}>
            <Text style={styles.link}>{diffOpen ? "Hide changes" : "View changes"}</Text>
          </Pressable>
          {canEdit ? (
            <Pressable
              onPress={() => {
                setSelectMode((m) => !m);
                setSelectedIds(new Set());
              }}
            >
              <Text style={styles.link}>{selectMode ? "Done selecting" : "Select"}</Text>
            </Pressable>
          ) : null}
          {canEdit ? (
            <Pressable onPress={() => act(() => api.submitFreightCircular(id))} disabled={busy}>
              <Text style={styles.link}>Submit for review</Text>
            </Pressable>
          ) : null}
          {draft.status === "review" ? (
            <>
              <Pressable onPress={approve} disabled={busy}>
                <Text style={styles.link}>Approve</Text>
              </Pressable>
              <Pressable
                onPress={() => act(() => api.reviewFreightCircular(id, false))}
                disabled={busy}
              >
                <Text style={styles.rejectLink}>Reject</Text>
              </Pressable>
            </>
          ) : null}
          {draft.status === "approved" ? (
            <Pressable onPress={() => act(() => api.publishFreightCircular(id))} disabled={busy}>
              <Text style={styles.link}>Publish</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {unmappedOpen && diff ? (
        <Card>
          <Text style={styles.diffTitle}>
            {diff.unmappedCount} unmapped destination{diff.unmappedCount === 1 ? "" : "s"}
          </Text>
          {diff.unmapped.slice(0, 100).map((u, i) => (
            <View key={`${u.destination}-${i}`} style={styles.diffRow}>
              <Text style={styles.diffField}>
                {u.destination}
                {u.isNew ? " (new)" : ""}
              </Text>
              <Text style={styles.diffValues}>
                {rupees(u.ratePerMt)}
                {u.state ? ` · ${u.state}` : ""}
              </Text>
            </View>
          ))}
          {diff.unmapped.length > 100 ? (
            <Text style={styles.diffMore}>+{diff.unmapped.length - 100} more</Text>
          ) : null}
          <Text style={styles.diffNote}>
            Map a location to each of these on the Locations screen to make the rate usable. They
            are not blocked from publishing once a reviewer has acknowledged them — they are simply
            inert until mapped.
          </Text>
        </Card>
      ) : null}

      {diffOpen && diff ? (
        <Card>
          <Text style={styles.diffTitle}>{diff.changedRowCount} rates changed</Text>
          {diff.changes.slice(0, 50).map((c, i) => (
            <View key={`${c.destination}-${i}`} style={styles.diffRow}>
              <Text style={styles.diffField}>{c.destination}</Text>
              <Text style={styles.diffValues}>
                {rupees(c.from)} → {rupees(c.to)} ({c.delta > 0 ? "+" : ""}
                {rupees(c.delta)})
              </Text>
            </View>
          ))}
          {diff.changes.length > 50 ? (
            <Text style={styles.diffMore}>+{diff.changes.length - 50} more</Text>
          ) : null}

          {diff.addedCount ? (
            <>
              <Text style={styles.diffTitle}>{diff.addedCount} destinations added</Text>
              {diff.added.slice(0, 50).map((a, i) => (
                <View key={`${a.destination}-${i}`} style={styles.diffRow}>
                  <Text style={styles.diffField}>{a.destination}</Text>
                  <Text style={styles.diffValues}>
                    {rupees(a.ratePerMt)}
                    {a.mapped ? "" : " · unmapped"}
                  </Text>
                </View>
              ))}
            </>
          ) : null}

          {diff.removedCount ? (
            <>
              <Text style={styles.diffTitle}>{diff.removedCount} destinations dropped</Text>
              <Text style={styles.diffValues}>{diff.removed.slice(0, 50).join(", ")}</Text>
              <Text style={styles.diffNote}>
                Dropped destinations disappear from the published book. Anyone quoting them will be
                told the producer publishes no rate there.
              </Text>
            </>
          ) : null}

          {diff.ambiguousCount ? (
            <>
              <Text style={styles.diffTitle}>
                {diff.ambiguousCount} destination{diff.ambiguousCount === 1 ? "" : "s"} matched by
                name, not exactly
              </Text>
              <Text style={styles.diffValues}>{diff.ambiguous.slice(0, 50).join(", ")}</Text>
              <Text style={styles.diffNote}>
                The producer's book carries two destinations that read as the same name — HMEL
                prints both "Bilaspur" and "Bilaspur(Ch)" at very different rates. The before-value
                shown for these is the closest match, not a certainty. Check them against the
                document.
              </Text>
            </>
          ) : null}
        </Card>
      ) : null}

      <DataGrid
        data={rows}
        keyExtractor={(r) => r._id}
        searchPlaceholder="Search destination, state or district"
        searchText={(r) => `${r.destination} ${r.state ?? ""} ${r.district ?? ""}`}
        filters={filters}
        selectable={selectMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onRowPress={(r) => (selectMode ? toggleSelect(r._id) : canEdit ? setSelected(r) : undefined)}
        renderRow={(r) => (
          <View>
            <Text style={styles.destination}>{r.destination}</Text>
            <Text style={styles.region}>
              {[r.state, r.district].filter(Boolean).join(" · ") || "No region on the source book"}
            </Text>
          </View>
        )}
        renderBadge={(r) => (
          <View style={styles.badgeArea}>
            {r.changed ? <Pill label="CHANGED" color={colors.warning} /> : null}
            {r.isNew ? <Pill label="NEW" color={colors.primary} /> : null}
            {!r.mapped ? <Pill label="UNMAPPED" color={colors.danger} /> : null}
            <Text style={styles.price}>{rupees(r.ratePerMt)}</Text>
          </View>
        )}
      />

      <SelectionBar
        count={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        actions={
          canEdit ? (
            <Pressable onPress={() => setBulkOpen(true)}>
              <Text style={styles.link}>Bulk edit</Text>
            </Pressable>
          ) : undefined
        }
      />

      <EditDrawer
        visible={!!selected}
        title={selected?.destination ?? ""}
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <RowEditForm
            row={selected}
            draftId={id}
            onDone={() => {
              setSelected(null);
              load();
            }}
          />
        ) : null}
      </EditDrawer>

      <EditDrawer
        visible={bulkOpen}
        title={`Bulk edit ${selectedIds.size} destinations`}
        onClose={() => setBulkOpen(false)}
      >
        <BulkEditForm
          draftId={id}
          rowIds={[...selectedIds]}
          onDone={() => {
            setBulkOpen(false);
            setSelectedIds(new Set());
            setSelectMode(false);
            load();
          }}
        />
      </EditDrawer>
    </View>
  );
}

function RowEditForm({
  row,
  draftId,
  onDone,
}: {
  row: FreightCircularRow;
  draftId: string;
  onDone: () => void;
}) {
  const styles = useStyles();
  const [rate, setRate] = useState(String(row.ratePerMt));
  const [insurance, setInsurance] = useState(String(row.insurancePerMt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const value = Number(rate);
    const cover = Number(insurance);
    // A zero rate is a real edit — a producer can absorb freight to a town —
    // so this checks for "not a number", not for falsiness.
    if (rate.trim() === "" || Number.isNaN(value) || value < 0) {
      setError("Enter a valid rate per MT.");
      return;
    }
    if (insurance.trim() === "" || Number.isNaN(cover) || cover < 0) {
      setError("Enter a valid insurance rate, or 0.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateFreightCircularRow(draftId, row._id, value, cover);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that row.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Region</Text>
        <Text style={styles.detailValue}>
          {[row.state, row.district].filter(Boolean).join(" · ") || "—"}
        </Text>
      </View>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Cloned from</Text>
        <Text style={styles.detailValue}>
          {row.isNew ? "New destination" : rupees(row.previousRatePerMt)}
        </Text>
      </View>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Mapped to a location</Text>
        <Text style={styles.detailValue}>{row.mapped ? "Yes" : "No"}</Text>
      </View>
      <View style={styles.form}>
        <Field label="Freight rate (Rs/MT)">
          <Input value={rate} onChangeText={setRate} keyboardType="numeric" />
        </Field>
        <Field label="Insurance (Rs/MT)" hint="OPaL bills this separately; 0 for everyone else">
          <Input value={insurance} onChangeText={setInsurance} keyboardType="numeric" />
        </Field>
        {error ? <ErrorNote message={error} /> : null}
        <PrimaryButton label="Save" onPress={submit} busy={busy} />
      </View>
    </Card>
  );
}

function BulkEditForm({
  draftId,
  rowIds,
  onDone,
}: {
  draftId: string;
  rowIds: string[];
  onDone: () => void;
}) {
  const styles = useStyles();
  const [type, setType] = useState<"set" | "delta" | "percent">("percent");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const OPTIONS: Array<{ key: typeof type; label: string; placeholder: string }> = [
    { key: "set", label: "Set to", placeholder: "New rate, Rs/MT" },
    { key: "delta", label: "Add/subtract", placeholder: "e.g. 250 or -250" },
    { key: "percent", label: "Percent change", placeholder: "e.g. 3 or -3" },
  ];

  async function submit() {
    const num = Number(value);
    if (!value.trim() || Number.isNaN(num)) {
      setError("Enter a value.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.bulkUpdateFreightCircularRows(draftId, rowIds, type, num);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Field label="Operation">
        <View style={styles.basisRow}>
          {OPTIONS.map((o) => (
            <Pressable
              key={o.key}
              onPress={() => setType(o.key)}
              style={[styles.basisOption, type === o.key && styles.basisActive]}
            >
              <Text style={[styles.basisText, type === o.key && styles.basisTextActive]}>
                {o.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field label={OPTIONS.find((o) => o.key === type)?.label ?? "Value"}>
        <Input
          value={value}
          onChangeText={setValue}
          keyboardType="numeric"
          placeholder={OPTIONS.find((o) => o.key === type)?.placeholder}
        />
      </Field>
      {error ? <ErrorNote message={error} /> : null}
      <PrimaryButton label={`Apply to ${rowIds.length} destinations`} onPress={submit} busy={busy} />
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  errorWrap: { paddingHorizontal: theme.space(4), paddingTop: theme.space(3) },
  header: { paddingHorizontal: theme.space(4), paddingTop: theme.space(3), paddingBottom: theme.space(2) },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: c.textPrimary, fontSize: 16, fontWeight: "800" },
  subtitle: { color: c.textFaint, fontSize: 12, marginTop: 2 },
  warnBanner: {
    marginTop: theme.space(3),
    padding: theme.space(3),
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: c.warning,
    gap: 4,
  },
  warnText: { color: c.textPrimary, fontSize: 12, lineHeight: 17 },
  warnLink: { color: c.warning, fontSize: 12, fontWeight: "700" },
  headerActions: { flexDirection: "row", gap: theme.space(4), marginTop: theme.space(2), flexWrap: "wrap" },
  link: { color: c.primary, fontSize: 12, fontWeight: "700" },
  rejectLink: { color: c.danger, fontSize: 12, fontWeight: "700" },
  diffTitle: { color: c.textMuted, fontSize: 11, fontWeight: "700", marginTop: theme.space(2), marginBottom: theme.space(2) },
  diffRow: { paddingVertical: 3, flexDirection: "row", justifyContent: "space-between" },
  diffField: { color: c.textPrimary, fontSize: 12, fontWeight: "700" },
  diffValues: { color: c.textMuted, fontSize: 12 },
  diffMore: { color: c.textFaint, fontSize: 11, marginTop: theme.space(1) },
  diffNote: { color: c.textFaint, fontSize: 11, marginTop: theme.space(2), lineHeight: 16 },
  destination: { color: c.textPrimary, fontSize: 14, fontWeight: "700" },
  region: { color: c.textFaint, fontSize: 12, marginTop: 2 },
  badgeArea: { alignItems: "flex-end", gap: 4 },
  price: { color: c.textPrimary, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  detailLabel: { color: c.textMuted, fontSize: 13 },
  detailValue: { color: c.textPrimary, fontSize: 13, fontWeight: "700" },
  form: { marginTop: theme.space(3), gap: theme.space(1) },
  basisRow: { flexDirection: "row", gap: theme.space(2), flexWrap: "wrap" },
  basisOption: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
  },
  basisActive: { backgroundColor: c.primary, borderColor: c.primary },
  basisText: { color: c.textMuted, fontSize: 12 },
  basisTextActive: { color: c.onPrimary, fontWeight: "700" },
}));
