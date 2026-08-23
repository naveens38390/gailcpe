import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api, type Correction, type GailBookRow } from "../../services/api";
import { DataGrid, EditDrawer, SelectionBar } from "../../components/dataGrid";
import { Field, Input, PrimaryButton } from "../../components/inputs";
import { rupees, theme } from "../../theme";
import { Card, ErrorNote, Loading, Pill } from "../../components/ui";
import { makeStyles, useTheme } from "../../context/theme";

/**
 * Price Book — the Data Grid Module's first real consumer, proven against
 * GAIL's actual 16,589-row live price matrix, not a synthetic demo.
 *
 * Search -> tap a row -> Edit Drawer -> propose a correction. No inline cell
 * editing, no wide table, no horizontal scroll — this is the pattern Price
 * Circular Management and Freight Circular Management build on next.
 * Selection is wired (checkboxes, a selected-count bar) so that
 * infrastructure already exists; the bulk *action* itself is a labelled
 * placeholder until Price Circular Management gives it something real to do.
 */
export default function PriceBookScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const canPropose = true;

  const [rows, setRows] = useState<GailBookRow[]>([]);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GailBookRow | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [book, corrections] = await Promise.all([api.gailBook(), api.corrections("pending")]);
      setRows(book);
      setPendingKeys(new Set(corrections.map((c: Correction) => `${c.zone}|${c.grade}`)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the price book.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filters = useMemo(
    () => [
      {
        key: "pending",
        label: "Has pending correction",
        predicate: (r: GailBookRow) => pendingKeys.has(`${r.zone}|${r.grade}`),
      },
    ],
    [pendingKeys],
  );

  function toggleSelect(id: string) {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) return <Loading label="Loading GAIL's price book" />;

  return (
    <View style={styles.root}>
      {error ? (
        <View style={styles.errorWrap}>
          <ErrorNote message={error} />
        </View>
      ) : null}

      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>GAIL price book</Text>
        <Pressable
          onPress={() => {
            setSelectMode((m) => !m);
            setSelectedIds(new Set());
          }}
        >
          <Text style={styles.link}>{selectMode ? "Done" : "Select"}</Text>
        </Pressable>
      </View>

      <DataGrid
        data={rows}
        keyExtractor={(r) => `${r.zone}|${r.grade}`}
        searchPlaceholder="Search grade or zone"
        searchText={(r) => `${r.grade} ${r.zone}`}
        filters={filters}
        selectable={selectMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onRowPress={(r) => (selectMode ? toggleSelect(`${r.zone}|${r.grade}`) : setSelected(r))}
        renderRow={(r) => (
          <View>
            <Text style={styles.grade}>{r.grade}</Text>
            <Text style={styles.zone}>{r.zone}</Text>
          </View>
        )}
        renderBadge={(r) => (
          <View style={styles.badgeArea}>
            {pendingKeys.has(`${r.zone}|${r.grade}`) ? <Pill label="PENDING" color={colors.warning} /> : null}
            <Text style={styles.price}>{rupees(r.price)}</Text>
          </View>
        )}
      />

      <SelectionBar
        count={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        actions={
          <Pressable disabled>
            <Text style={styles.bulkDisabled}>Bulk edit — coming with Price Circular Management</Text>
          </Pressable>
        }
      />

      <EditDrawer visible={!!selected} title={selected?.grade ?? ""} onClose={() => setSelected(null)}>
        {selected ? (
          <RowDetail
            row={selected}
            canPropose={canPropose}
            onDone={() => {
              setSelected(null);
              load();
            }}
          />
        ) : null}
      </EditDrawer>
    </View>
  );
}

function RowDetail({
  row,
  canPropose,
  onDone,
}: {
  row: GailBookRow;
  canPropose: boolean;
  onDone: () => void;
}) {
  const styles = useStyles();
  const [proposedPrice, setProposedPrice] = useState(String(row.price));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const price = Number(proposedPrice);
    if (!price || reason.trim().length < 10) {
      setError("A valid price and a reason of at least 10 characters are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.proposeCorrection({
        grade: row.grade,
        location: row.zone,
        proposedPrice: price,
        reason: reason.trim(),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit that correction.");
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
        <Text style={styles.detailLabel}>Current price</Text>
        <Text style={styles.detailValue}>{rupees(row.price)}</Text>
      </View>

      {canPropose ? (
        <View style={styles.form}>
          <Field label="Proposed price (Rs/MT)">
            <Input value={proposedPrice} onChangeText={setProposedPrice} keyboardType="numeric" />
          </Field>
          <Field label="Reason">
            <Input value={reason} onChangeText={setReason} placeholder="Why this price is changing" />
          </Field>
          {error ? <ErrorNote message={error} /> : null}
          <PrimaryButton label="Submit for approval" onPress={submit} busy={busy} />
        </View>
      ) : (
        <Text style={styles.readOnlyNote}>Your role can view this price but not propose a correction.</Text>
      )}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bgApp },
  errorWrap: { paddingHorizontal: theme.space(4), paddingTop: theme.space(3) },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: theme.space(4),
    paddingTop: theme.space(3),
  },
  toolbarTitle: { color: c.textPrimary, fontSize: 15, fontWeight: "700" },
  link: { color: c.primary, fontSize: 13, fontWeight: "700" },
  grade: { color: c.textPrimary, fontSize: 14, fontWeight: "700" },
  zone: { color: c.textFaint, fontSize: 12, marginTop: 2 },
  badgeArea: { alignItems: "flex-end", gap: 4 },
  price: { color: c.textPrimary, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  bulkDisabled: { color: c.textFaint, fontSize: 11, fontStyle: "italic" },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  detailLabel: { color: c.textMuted, fontSize: 13 },
  detailValue: { color: c.textPrimary, fontSize: 13, fontWeight: "700" },
  form: { marginTop: theme.space(3), gap: theme.space(1) },
  readOnlyNote: { color: c.textMuted, fontSize: 13, marginTop: theme.space(3) },
}));
