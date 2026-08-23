import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  api,
  type PriceCircularDraft,
  type PriceCircularRow,
  type PriceCircularRowDiff,
} from "../../../services/api";
import { DataGrid, EditDrawer, SelectionBar } from "../../../components/dataGrid";
import { Field, Input, PrimaryButton } from "../../../components/inputs";
import { revisionStatusColor } from "../../../components/masterData";
import { rupees, theme } from "../../../theme";
import { Card, ErrorNote, ExportButtons, Loading, Pill } from "../../../components/ui";
import { makeStyles, useTheme } from "../../../context/theme";

/**
 * One draft circular's rows — the Data Grid Module's second real consumer
 * (after Price Book), now with editing: tap a row -> Edit Drawer -> save,
 * or select many -> one bulk operation -> one save. No inline cell editing,
 * no wide table, exactly the pattern already proven at 16,589-row scale.
 */
export default function PriceCircularRowsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const canPropose = true;
  const canReview = true;
  const canPublish = true;

  const [draft, setDraft] = useState<PriceCircularDraft | null>(null);
  const [rows, setRows] = useState<PriceCircularRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PriceCircularRow | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diff, setDiff] = useState<PriceCircularRowDiff | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([api.priceCircularDetail(id), api.priceCircularRows(id)]);
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

  const canEdit = canPropose && draft?.status === "draft";

  const filters = useMemo(
    () => [{ key: "changed", label: "Changed only", predicate: (r: PriceCircularRow) => r.changed }],
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

  async function openDiff() {
    if (diffOpen) {
      setDiffOpen(false);
      return;
    }
    setDiffOpen(true);
    try {
      setDiff(await api.priceCircularRowDiff(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the diff.");
    }
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

  if (loading || !draft) return <Loading label="Loading circular" />;

  return (
    <View style={styles.root}>
      {error ? (
        <View style={styles.errorWrap}>
          <ErrorNote message={error} />
        </View>
      ) : null}

      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{draft.circularNumber}</Text>
          <Pill label={draft.status.toUpperCase()} color={revisionStatusColor(colors)[draft.status] ?? colors.neutral} />
        </View>
        <Text style={styles.subtitle}>
          {draft.rowCount.toLocaleString("en-IN")} rows · {draft.changedRowCount.toLocaleString("en-IN")} changed
        </Text>
        {draft.status === "published" && draft.publishedCircular ? (
          <ExportButtons
            excel={{
              path: `/exports/price-circular/${draft.publishedCircular}/excel`,
              filename: `PriceCircular-${draft.circularNumber}.xlsx`,
            }}
            pdf={{
              path: `/exports/price-circular/${draft.publishedCircular}/pdf`,
              filename: `PriceCircular-${draft.circularNumber}.pdf`,
            }}
          />
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
            <Pressable onPress={() => act(() => api.submitPriceCircular(id))} disabled={busy}>
              <Text style={styles.link}>Submit for review</Text>
            </Pressable>
          ) : null}
          {canReview && draft.status === "review" ? (
            <>
              <Pressable onPress={() => act(() => api.reviewPriceCircular(id, true))} disabled={busy}>
                <Text style={styles.link}>Approve</Text>
              </Pressable>
              <Pressable onPress={() => act(() => api.reviewPriceCircular(id, false))} disabled={busy}>
                <Text style={styles.rejectLink}>Reject</Text>
              </Pressable>
            </>
          ) : null}
          {canPublish && draft.status === "approved" ? (
            <Pressable onPress={() => act(() => api.publishPriceCircular(id))} disabled={busy}>
              <Text style={styles.link}>Publish</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {diffOpen && diff ? (
        <Card>
          <Text style={styles.diffTitle}>{diff.changedRowCount} rows changed</Text>
          {diff.changes.slice(0, 50).map((c) => (
            <View key={`${c.zone}|${c.grade}`} style={styles.diffRow}>
              <Text style={styles.diffField}>
                {c.grade} · {c.zone}
              </Text>
              <Text style={styles.diffValues}>
                {rupees(c.from)} → {rupees(c.to)} ({c.delta > 0 ? "+" : ""}
                {rupees(c.delta)})
              </Text>
            </View>
          ))}
          {diff.changes.length > 50 ? (
            <Text style={styles.diffMore}>+{diff.changes.length - 50} more</Text>
          ) : null}
        </Card>
      ) : null}

      <DataGrid
        data={rows}
        keyExtractor={(r) => r._id}
        searchPlaceholder="Search grade or zone"
        searchText={(r) => `${r.grade} ${r.zone}`}
        filters={filters}
        selectable={selectMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onRowPress={(r) => (selectMode ? toggleSelect(r._id) : canEdit ? setSelected(r) : undefined)}
        renderRow={(r) => (
          <View>
            <Text style={styles.grade}>{r.grade}</Text>
            <Text style={styles.zone}>{r.zone}</Text>
          </View>
        )}
        renderBadge={(r) => (
          <View style={styles.badgeArea}>
            {r.changed ? <Pill label="CHANGED" color={colors.warning} /> : null}
            <Text style={styles.price}>{rupees(r.basicPrice)}</Text>
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

      <EditDrawer visible={!!selected} title={selected?.grade ?? ""} onClose={() => setSelected(null)}>
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

      <EditDrawer visible={bulkOpen} title={`Bulk edit ${selectedIds.size} rows`} onClose={() => setBulkOpen(false)}>
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
  row: PriceCircularRow;
  draftId: string;
  onDone: () => void;
}) {
  const styles = useStyles();
  const [price, setPrice] = useState(String(row.basicPrice));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const value = Number(price);
    if (!value) {
      setError("Enter a valid price.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updatePriceCircularRow(draftId, row._id, value);
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
        <Text style={styles.detailLabel}>Zone</Text>
        <Text style={styles.detailValue}>{row.zone}</Text>
      </View>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Cloned from</Text>
        <Text style={styles.detailValue}>{rupees(row.previousPrice)}</Text>
      </View>
      <View style={styles.form}>
        <Field label="Basic price (Rs/MT)">
          <Input value={price} onChangeText={setPrice} keyboardType="numeric" />
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

  async function submit() {
    const num = Number(value);
    if (!value.trim() || Number.isNaN(num)) {
      setError("Enter a value.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.bulkUpdatePriceCircularRows(draftId, rowIds, type, num);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk update failed.");
    } finally {
      setBusy(false);
    }
  }

  const OPTIONS: Array<{ key: typeof type; label: string; placeholder: string }> = [
    { key: "set", label: "Set to", placeholder: "New price, Rs/MT" },
    { key: "delta", label: "Add/subtract", placeholder: "e.g. 500 or -500" },
    { key: "percent", label: "Percent change", placeholder: "e.g. 2 or -2" },
  ];

  return (
    <Card>
      <Field label="Operation">
        <View style={styles.basisRow}>
          {OPTIONS.map((o) => (
            <Pressable key={o.key} onPress={() => setType(o.key)} style={[styles.basisOption, type === o.key && styles.basisActive]}>
              <Text style={[styles.basisText, type === o.key && styles.basisTextActive]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field label={OPTIONS.find((o) => o.key === type)?.label ?? "Value"}>
        <Input value={value} onChangeText={setValue} keyboardType="numeric" placeholder={OPTIONS.find((o) => o.key === type)?.placeholder} />
      </Field>
      {error ? <ErrorNote message={error} /> : null}
      <PrimaryButton label={`Apply to ${rowIds.length} rows`} onPress={submit} busy={busy} />
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
  headerActions: { flexDirection: "row", gap: theme.space(4), marginTop: theme.space(2), flexWrap: "wrap" },
  link: { color: c.primary, fontSize: 12, fontWeight: "700" },
  rejectLink: { color: c.danger, fontSize: 12, fontWeight: "700" },
  diffTitle: { color: c.textMuted, fontSize: 11, fontWeight: "700", marginBottom: theme.space(2) },
  diffRow: { paddingVertical: 3, flexDirection: "row", justifyContent: "space-between" },
  diffField: { color: c.textPrimary, fontSize: 12, fontWeight: "700" },
  diffValues: { color: c.textMuted, fontSize: 12 },
  diffMore: { color: c.textFaint, fontSize: 11, marginTop: theme.space(1) },
  grade: { color: c.textPrimary, fontSize: 14, fontWeight: "700" },
  zone: { color: c.textFaint, fontSize: 12, marginTop: 2 },
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
