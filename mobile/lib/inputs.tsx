/**
 * The grade / location / quantity / terms form, shared by Compare and Deal.
 *
 * Both screens ask exactly the same four questions and must not drift apart —
 * an officer who fills them on one tab should recognise the other immediately.
 */

import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { api, type GradeHit, type LocationHit, type PaymentMode } from "./api";
import { theme } from "./theme";

export interface QueryInputs {
  grade: string;
  location: string;
  quantityMt: string;
  paymentMode: PaymentMode;
}

export function useSuggestions(term: string, kind: "grade" | "location") {
  const [items, setItems] = useState<Array<GradeHit | LocationHit>>([]);

  useEffect(() => {
    const value = term.trim();
    if (value.length < 2) {
      setItems([]);
      return;
    }
    // Debounced: the officer is typing on a phone, often on mobile data.
    const timer = setTimeout(async () => {
      try {
        setItems(
          kind === "grade"
            ? await api.searchGrades(value)
            : await api.searchLocations(value),
        );
      } catch {
        setItems([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [term, kind]);

  return items;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Input(props: ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      {...props}
      style={[styles.input, props.style]}
      placeholderTextColor={theme.color.textFaint}
    />
  );
}

export function Suggestions({
  items,
  onPick,
}: {
  items: Array<GradeHit | LocationHit>;
  onPick: (value: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.suggestions}
    >
      {items.slice(0, 8).map((item) => {
        const isGrade = "gailGrade" in item;
        const value = isGrade ? item.gailGrade : item.name;
        // A location with no competitor price yields a one-sided comparison.
        // Say so in the picker, not after the officer has built a quote on it.
        const note = isGrade
          ? item.application
          : item.competitorsPriced === 0
            ? "no competitor price"
            : `${item.competitorsPriced} competitors`;
        return (
          <Pressable
            key={value}
            style={styles.suggestion}
            onPress={() => onPick(value)}
          >
            <Text style={styles.suggestionValue}>{value}</Text>
            {note ? <Text style={styles.suggestionNote}>{note}</Text> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function PaymentToggle({
  value,
  onChange,
}: {
  value: PaymentMode;
  onChange: (mode: PaymentMode) => void;
}) {
  const options: Array<{ key: PaymentMode; label: string }> = [
    { key: "cash", label: "Cash" },
    { key: "credit_ifc", label: "Credit (IFC)" },
  ];
  return (
    <View style={styles.toggle}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={[styles.toggleOption, active && styles.toggleActive]}
          >
            <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  busy,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      style={[styles.button, busy && styles.buttonBusy]}
      onPress={onPress}
      disabled={busy}
    >
      <Text style={styles.buttonText}>{busy ? "Working…" : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: theme.space(3) },
  label: {
    color: theme.color.textMuted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: theme.space(1),
  },
  hint: { color: theme.color.textFaint, fontSize: 11, marginTop: theme.space(1) },
  input: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    color: theme.color.text,
    padding: theme.space(3),
    fontSize: 15,
  },
  suggestions: { marginTop: theme.space(2) },
  suggestion: {
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
    marginRight: theme.space(2),
  },
  suggestionValue: { color: theme.color.text, fontWeight: "700", fontSize: 13 },
  suggestionNote: { color: theme.color.textFaint, fontSize: 10, marginTop: 2 },
  toggle: {
    flexDirection: "row",
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: 3,
  },
  toggleOption: {
    flex: 1,
    paddingVertical: theme.space(2),
    borderRadius: theme.radius.sm,
    alignItems: "center",
  },
  toggleActive: { backgroundColor: theme.color.accent },
  toggleText: { color: theme.color.textMuted, fontWeight: "700", fontSize: 13 },
  toggleTextActive: { color: "#FFFFFF" },
  button: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    padding: theme.space(4),
    alignItems: "center",
    marginTop: theme.space(2),
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
});
