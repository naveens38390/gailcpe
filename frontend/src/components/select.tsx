/**
 * Selection, not typing.
 *
 * Grade, location and producer all have a closed set of valid values published
 * in the circulars, so none of them is a text box. Each option carries what is
 * available behind it, which is what lets one choice narrow the next: pick a
 * grade and the location list shrinks to the places it is priced, pick a
 * location and only the producers quoting there remain.
 */

import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState, type ReactNode } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";

import { makeStyles, useTheme } from "../context/theme";
import { theme } from "../theme";

export interface Option {
  /** The value submitted to the API. */
  value: string;
  /** What the option is called. */
  label: string;
  /** One line of context under the label. */
  detail?: string;
  /** Short right-aligned tag — availability, producer count, tier. */
  badge?: string;
  badgeTone?: "success" | "warning" | "danger" | "neutral";
  /** Extra text matched by the search box but not displayed. */
  keywords?: string;
  disabled?: boolean;
}

function toneColor(tone: Option["badgeTone"], c: ReturnType<typeof useTheme>["colors"]) {
  switch (tone) {
    case "success":
      return c.success;
    case "warning":
      return c.warning;
    case "danger":
      return c.danger;
    default:
      return c.textFaint;
  }
}

export function SelectField({
  label,
  hint,
  placeholder,
  value,
  options,
  onChange,
  disabled,
  loading,
  emptyText = "Nothing available for this combination.",
}: {
  label: string;
  hint?: string;
  placeholder: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  loading?: boolean;
  emptyText?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toUpperCase().includes(q) ||
        o.value.toUpperCase().includes(q) ||
        (o.detail ?? "").toUpperCase().includes(q) ||
        (o.keywords ?? "").toUpperCase().includes(q),
    );
  }, [options, query]);

  const inactive = disabled || loading;

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.count}>
          {loading ? "loading…" : `${options.length} available`}
        </Text>
      </View>

      <Pressable
        style={[styles.control, inactive && styles.controlDisabled]}
        onPress={() => {
          if (inactive) return;
          setQuery("");
          setOpen(true);
        }}
      >
        <View style={styles.controlText}>
          <Text style={selected ? styles.valueText : styles.placeholderText} numberOfLines={1}>
            {selected ? selected.label : placeholder}
          </Text>
          {selected?.detail ? (
            <Text style={styles.valueDetail} numberOfLines={1}>
              {selected.detail}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.textFaint} />
      </Pressable>

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={colors.textFaint} />
              <TextInput
                style={styles.search}
                value={query}
                onChangeText={setQuery}
                placeholder={`Search ${options.length} options`}
                placeholderTextColor={colors.textFaint}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(o) => o.value}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <Pressable
                    style={[styles.row, isSelected && styles.rowSelected]}
                    disabled={item.disabled}
                    onPress={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                  >
                    <View style={styles.rowText}>
                      <Text
                        style={[styles.rowLabel, item.disabled && styles.rowDisabled]}
                        numberOfLines={1}
                      >
                        {item.label}
                      </Text>
                      {item.detail ? (
                        <Text style={styles.rowDetail} numberOfLines={2}>
                          {item.detail}
                        </Text>
                      ) : null}
                    </View>
                    {item.badge ? (
                      <Text style={[styles.badge, { color: toneColor(item.badgeTone, colors) }]}>
                        {item.badge}
                      </Text>
                    ) : null}
                    {isSelected ? (
                      <Ionicons name="checkmark" size={18} color={colors.primary} />
                    ) : null}
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** A single-select row of chips — for short, always-visible option sets. */
export function ChipSelect<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; detail?: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.chipRow}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            style={[styles.chip, on && styles.chipOn]}
            onPress={() => onChange(o.value)}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A multi-select row of chips — used to include or exclude competitors. */
export function ChipMulti({
  options,
  selected,
  onToggle,
}: {
  options: Array<{ value: string; label: string; color?: string; disabled?: boolean }>;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.chipRow}>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <Pressable
            key={o.value}
            disabled={o.disabled}
            style={[
              styles.chip,
              on && { backgroundColor: o.color ?? colors.primary, borderColor: o.color ?? colors.primary },
              o.disabled && styles.chipDisabled,
            ]}
            onPress={() => onToggle(o.value)}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FieldShell({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  field: { marginBottom: theme.space(4) },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  label: {
    color: c.textMuted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: theme.space(2),
  },
  count: { color: c.textFaint, fontSize: 10, marginBottom: theme.space(2) },
  control: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(2),
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    minHeight: 52,
  },
  controlDisabled: { opacity: 0.5 },
  controlText: { flex: 1 },
  valueText: { color: c.textPrimary, fontSize: 16, fontWeight: "700" },
  valueDetail: { color: c.textFaint, fontSize: 11, marginTop: 1 },
  placeholderText: { color: c.textFaint, fontSize: 16 },
  hint: { color: c.textFaint, fontSize: 11, marginTop: theme.space(1), lineHeight: 16 },

  backdrop: { flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: c.surfaceCard,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: "85%",
    paddingTop: theme.space(4),
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.space(5),
    paddingBottom: theme.space(3),
  },
  sheetTitle: { color: c.textPrimary, fontSize: 17, fontWeight: "800" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(2),
    marginHorizontal: theme.space(5),
    marginBottom: theme.space(3),
    paddingHorizontal: theme.space(3),
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.md,
  },
  search: { flex: 1, color: c.textPrimary, fontSize: 15, paddingVertical: theme.space(3) },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(3),
    paddingHorizontal: theme.space(5),
    paddingVertical: theme.space(3),
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  rowSelected: { backgroundColor: c.surfaceAlt },
  rowText: { flex: 1 },
  rowLabel: { color: c.textPrimary, fontSize: 15, fontWeight: "700" },
  rowDisabled: { color: c.textFaint },
  rowDetail: { color: c.textMuted, fontSize: 12, marginTop: 2, lineHeight: 16 },
  badge: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  empty: { color: c.textMuted, fontSize: 13, padding: theme.space(6), textAlign: "center" },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.space(2) },
  chip: {
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceAlt,
    borderRadius: 999,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
  },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipDisabled: { opacity: 0.35 },
  chipText: { color: c.textMuted, fontSize: 12, fontWeight: "700" },
  chipTextOn: { color: c.onPrimary },
}));
