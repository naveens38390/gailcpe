/**
 * The reusable mobile data-grid engine — the answer to "how do we manage
 * 16,000-row price circulars and 1,900-row freight circulars on a phone."
 *
 * Deliberately not an Excel clone: no inline cell editing, no horizontal
 * scroll, no grid-of-columns. The pattern is Search -> Filter -> tap a row
 * -> full-screen Edit Drawer -> save. One virtualized list (FlashList, not
 * FlatList — it holds up at this scale without the memory cost), a compact
 * card per row, and a drawer host for whatever a caller wants to edit.
 *
 * Selection is built in (checkboxes, a selected-count bar) because bulk
 * actions are explicitly a "later" UI on top of infrastructure that has to
 * exist "now" — Price Circular Management is the first real consumer.
 */

import { FlashList } from "@shopify/flash-list";
import { useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { theme } from "./theme";

export interface DataGridFilter<T> {
  key: string;
  label: string;
  predicate: (row: T) => boolean;
}

export interface DataGridProps<T> {
  data: T[];
  keyExtractor: (row: T) => string;
  /** Compact card content for one row — 2-3 lines, never a wide table row. */
  renderRow: (row: T) => ReactNode;
  searchPlaceholder?: string;
  /** Combined lowercase-searchable text for one row. */
  searchText?: (row: T) => string;
  filters?: DataGridFilter<T>[];
  onRowPress?: (row: T) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  /** e.g. a "pending change" dot — rendered at the trailing edge of a row. */
  renderBadge?: (row: T) => ReactNode;
  emptyLabel?: string;
}

export function DataGrid<T>({
  data,
  keyExtractor,
  renderRow,
  searchPlaceholder = "Search",
  searchText,
  filters,
  onRowPress,
  selectable,
  selectedIds,
  onToggleSelect,
  renderBadge,
  emptyLabel = "No rows match.",
}: DataGridProps<T>) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let rows = data;
    const filter = filters?.find((f) => f.key === activeFilter);
    if (filter) rows = rows.filter(filter.predicate);
    const q = query.trim().toLowerCase();
    if (q && searchText) rows = rows.filter((r) => searchText(r).toLowerCase().includes(q));
    return rows;
  }, [data, query, activeFilter, filters, searchText]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder}
          placeholderTextColor={theme.color.textFaint}
          style={styles.search}
        />
        {filters?.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
            <Pressable
              onPress={() => setActiveFilter(null)}
              style={[styles.filterChip, !activeFilter && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, !activeFilter && styles.filterTextActive]}>All</Text>
            </Pressable>
            {filters.map((f) => (
              <Pressable
                key={f.key}
                onPress={() => setActiveFilter(f.key)}
                style={[styles.filterChip, activeFilter === f.key && styles.filterChipActive]}
              >
                <Text style={[styles.filterText, activeFilter === f.key && styles.filterTextActive]}>
                  {f.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <Text style={styles.count}>{filtered.length.toLocaleString("en-IN")} rows</Text>
      </View>

      <View style={styles.listArea}>
        <FlashList
          data={filtered}
          keyExtractor={keyExtractor}
          renderItem={({ item }) => {
            const id = keyExtractor(item);
            const selected = selectedIds?.has(id) ?? false;
            return (
              <Pressable style={styles.row} onPress={() => onRowPress?.(item)}>
                {selectable ? (
                  <Pressable
                    onPress={() => onToggleSelect?.(id)}
                    style={[styles.checkbox, selected && styles.checkboxChecked]}
                    hitSlop={8}
                  >
                    {selected ? <Text style={styles.checkboxMark}>✓</Text> : null}
                  </Pressable>
                ) : null}
                <View style={styles.rowBody}>{renderRow(item)}</View>
                {renderBadge ? renderBadge(item) : null}
              </Pressable>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>{emptyLabel}</Text>}
        />
      </View>
    </View>
  );
}

/** Full-screen edit host: tap a row, edit fields, save — never an inline cell. */
export function EditDrawer({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.drawer}>
          <View style={styles.drawerHead}>
            <Text style={styles.drawerTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.drawerClose}>Close</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.drawerBody}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** The bar that appears once rows are selected — bulk actions wire in here. */
export function SelectionBar({
  count,
  onClear,
  actions,
}: {
  count: number;
  onClear: () => void;
  actions?: ReactNode;
}) {
  if (!count) return null;
  return (
    <View style={styles.selectionBar}>
      <Text style={styles.selectionCount}>{count} selected</Text>
      <View style={styles.selectionActions}>
        {actions}
        <Pressable onPress={onClear}>
          <Text style={styles.selectionClear}>Clear</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: theme.space(4), paddingTop: theme.space(3) },
  search: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    color: theme.color.text,
    padding: theme.space(3),
    fontSize: 15,
  },
  filterRow: { marginTop: theme.space(2), flexGrow: 0 },
  filterChip: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: 999,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(1),
    marginRight: theme.space(2),
  },
  filterChipActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  filterText: { color: theme.color.textMuted, fontSize: 12, fontWeight: "600" },
  filterTextActive: { color: "#FFFFFF" },
  count: { color: theme.color.textFaint, fontSize: 11, marginTop: theme.space(2), marginBottom: theme.space(1) },
  listArea: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(3),
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  rowBody: { flex: 1 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: theme.color.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  checkboxMark: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  empty: { color: theme.color.textMuted, fontSize: 13, textAlign: "center", padding: theme.space(8) },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  drawer: {
    backgroundColor: theme.color.bg,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: "85%",
    minHeight: "40%",
  },
  drawerHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: theme.space(4),
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  drawerTitle: { color: theme.color.text, fontSize: 16, fontWeight: "800" },
  drawerClose: { color: theme.color.accent, fontSize: 14, fontWeight: "700" },
  drawerBody: { padding: theme.space(4), paddingBottom: theme.space(10) },
  selectionBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: theme.color.surfaceAlt,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(2),
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  selectionCount: { color: theme.color.text, fontSize: 13, fontWeight: "700" },
  selectionActions: { flexDirection: "row", alignItems: "center", gap: theme.space(4) },
  selectionClear: { color: theme.color.behind, fontSize: 12, fontWeight: "700" },
});
