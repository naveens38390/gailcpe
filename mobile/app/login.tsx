import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_BASE_URL } from "../lib/api";
import { useAuth } from "../lib/auth";
import { theme } from "../lib/theme";
import { ErrorNote } from "../lib/ui";

export default function Login() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + 64 }]}>
        <Text style={styles.brand}>GCPE</Text>
        <Text style={styles.tagline}>
          GAIL PE competitive pricing — grade, location, quantity, terms.
        </Text>

        {error ? <ErrorNote message={error} /> : null}

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="name@gail.co.in"
          placeholderTextColor={theme.color.textFaint}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          placeholder="••••••••"
          placeholderTextColor={theme.color.textFaint}
          onSubmitEditing={submit}
        />

        <Pressable
          style={[styles.button, busy && styles.buttonBusy]}
          onPress={submit}
          disabled={busy}
        >
          <Text style={styles.buttonText}>{busy ? "Signing in…" : "Sign in"}</Text>
        </Pressable>

        <Text style={styles.host}>{API_BASE_URL}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  body: { padding: theme.space(6), gap: theme.space(2) },
  brand: {
    color: theme.color.text,
    fontSize: 40,
    fontWeight: "800",
    letterSpacing: 2,
  },
  tagline: {
    color: theme.color.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: theme.space(6),
  },
  label: {
    color: theme.color.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: theme.space(3),
  },
  input: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    color: theme.color.text,
    padding: theme.space(4),
    fontSize: 16,
  },
  button: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    padding: theme.space(4),
    alignItems: "center",
    marginTop: theme.space(6),
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  host: {
    color: theme.color.textFaint,
    fontSize: 11,
    textAlign: "center",
    marginTop: theme.space(6),
  },
});
