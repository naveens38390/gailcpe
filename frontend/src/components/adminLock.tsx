/**
 * What stands in front of the Admin Panel until someone signs in.
 *
 * Drawn as an overlay rather than in place of the stack: Expo Router mounts
 * routes only once a layout renders its navigator, so replacing it would leave
 * the panel stuck on a blank screen.
 */

import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useAdminGate } from "../context/adminGate";
import { makeStyles, useTheme } from "../context/theme";
import { theme } from "../theme";
import { ErrorNote } from "./ui";

export function AdminLock() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { unlock } = useAdminGate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await unlock(email, password);
    } catch (e) {
      // The API returns the same message for a wrong email and a wrong
      // password, and so does this.
      setError(e instanceof Error ? e.message : "Those credentials were not accepted.");
    } finally {
      setBusy(false);
    }
  }

  const ready = email.trim().length > 0 && password.length > 0;

  return (
    <View style={styles.overlay}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.badge}>
          <Ionicons name="lock-closed" size={22} color={colors.primary} />
        </View>

        <Text style={styles.title}>Admin Panel</Text>
        <Text style={styles.subtitle}>
          Everything here writes to the published dataset. Sign in to continue.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="name@example.com"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.textFaint}
              secureTextEntry={!show}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              onSubmitEditing={submit}
              returnKeyType="go"
            />
            <Pressable onPress={() => setShow((v) => !v)} hitSlop={10}>
              <Ionicons
                name={show ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={colors.textFaint}
              />
            </Pressable>
          </View>
        </View>

        {error ? <ErrorNote message={error} /> : null}

        <Pressable
          style={[styles.button, (!ready || busy) && styles.buttonOff]}
          onPress={submit}
          disabled={!ready || busy}
        >
          <Text style={styles.buttonText}>{busy ? "Checking…" : "Unlock"}</Text>
        </Pressable>

        <Text style={styles.footnote}>
          Verified against the pricing service, not on the device. The panel
          re-locks when the app is closed.
        </Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: c.bgApp,
  },
  body: { padding: theme.space(6), paddingTop: theme.space(10) },
  badge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: theme.space(4),
  },
  title: { color: c.textPrimary, fontSize: 24, fontWeight: "800" },
  subtitle: {
    color: c.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: theme.space(1),
    marginBottom: theme.space(6),
  },
  field: { marginBottom: theme.space(4) },
  label: {
    color: c.textMuted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: theme.space(2),
  },
  input: {
    backgroundColor: c.surfaceCard,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    color: c.textPrimary,
    fontSize: 16,
    minHeight: 52,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(3),
    backgroundColor: c.surfaceCard,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(4),
    minHeight: 52,
  },
  passwordInput: { flex: 1, color: c.textPrimary, fontSize: 16, paddingVertical: theme.space(3) },
  button: {
    backgroundColor: c.primary,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(4),
    alignItems: "center",
    marginTop: theme.space(2),
  },
  buttonOff: { opacity: 0.5 },
  buttonText: { color: c.onPrimary, fontSize: 16, fontWeight: "800" },
  footnote: {
    color: c.textFaint,
    fontSize: 11,
    lineHeight: 17,
    marginTop: theme.space(5),
  },
}));
