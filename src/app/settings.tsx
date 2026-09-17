import { Link, Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Spacing, MaxContentWidth, type ThemeColors } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  deleteGitHubToken,
  loadGitHubToken,
  saveGitHubToken,
} from "@/lib/github-token";

const TOKEN_CREATION_URL = "https://github.com/settings/tokens";

export default function SettingsScreen() {
  const colors = useTheme();
  const [token, setToken] = useState("");
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadGitHubToken()
      .then((stored) => {
        if (!active) return;
        setSavedToken(stored);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const onSave = useCallback(async () => {
    const value = token.trim();
    if (!value) {
      setError("Enter a token before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await saveGitHubToken(value);
      setSavedToken(value);
      setToken("");
      setMessage("GitHub token saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the token.");
    } finally {
      setSaving(false);
    }
  }, [token]);

  const onRemove = useCallback(async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await deleteGitHubToken();
      setSavedToken(null);
      setToken("");
      setMessage("GitHub token removed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the token.");
    } finally {
      setSaving(false);
    }
  }, []);

  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
    >
      <Stack.Screen options={{ title: "Settings" }} />

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>GitHub access token</Text>
        <Text style={styles.bodyText}>
          Tide data updates are fetched from the{" "}
          <Link
            href="https://github.com/openwatersio/tide-database"
            target="_blank"
            style={styles.linkStyle}
          >
            Neaps tide database
          </Link>{" "}
          via GitHub Releases. Mobile networks are shared by many users, so
          GitHub can rate-limit the app&apos;s IP address and reject downloads
          with HTTP 403. Adding a personal access token raises your allowance
          and fixes that.
        </Text>
        <Link href={TOKEN_CREATION_URL} target="_blank" style={styles.linkText}>
          Create a token (Settings → Developer settings)
        </Link>

        {Platform.OS === "web" ? (
          <Text style={styles.warningText}>
            Unavailable on web: the browser build ships a bundled tide-data
            snapshot and never talks to the GitHub API, and secure storage is
            only supported on Android and iOS.
          </Text>
        ) : busy ? (
          <ActivityIndicator color={colors.accent} size="small" />
        ) : (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Paste your GitHub token"
              placeholderTextColor={colors.textSecondary}
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            {savedToken ? (
              <Text style={styles.secondaryText}>Token has been set.</Text>
            ) : null}
            <View style={styles.buttonRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.pressed,
                ]}
                disabled={saving}
                onPress={onSave}
              >
                {saving ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>Save token</Text>
                )}
              </Pressable>
              {savedToken ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.pressed,
                  ]}
                  disabled={saving}
                  onPress={onRemove}
                >
                  <Text style={styles.secondaryButtonText}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
            {message ? <Text style={styles.successText}>{message}</Text> : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        )}

        <Text style={styles.smallText}>
          The token is encrypted at rest on your device (Android Keystore / iOS
          Keychain), stays on-device, and is excluded from Android backups.
        </Text>
      </View>
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    scrollContent: {
      padding: Spacing.two,
      paddingBottom: Spacing.six,
      width: "100%",
      maxWidth: MaxContentWidth,
      alignSelf: "center",
      gap: Spacing.two,
    },
    card: {
      backgroundColor: colors.backgroundElement,
      borderRadius: 12,
      padding: Spacing.three,
      gap: Spacing.two,
    },
    sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
    bodyText: { color: colors.text, fontSize: 14, lineHeight: 20 },
    smallText: { color: colors.textSecondary, fontSize: 12 },
    secondaryText: { color: colors.textSecondary, fontSize: 13 },
    successText: { color: colors.accent, fontSize: 13 },
    errorText: { color: colors.error, fontSize: 13 },
    warningText: { color: colors.textSecondary, fontSize: 13 },
    linkText: {
      color: colors.accent,
      fontSize: 14,
      textDecorationLine: "underline",
    },
    form: { gap: Spacing.two },
    input: {
      backgroundColor: colors.backgroundSelected,
      color: colors.text,
      borderRadius: 12,
      paddingHorizontal: Spacing.three,
      paddingVertical: Spacing.three,
      fontSize: 14,
    },
    buttonRow: { flexDirection: "row", gap: Spacing.two },
    primaryButton: {
      backgroundColor: colors.accent,
      borderRadius: 12,
      paddingHorizontal: Spacing.four,
      paddingVertical: Spacing.three,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 44,
    },
    primaryButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
    secondaryButton: {
      backgroundColor: colors.backgroundSelected,
      borderRadius: 12,
      paddingHorizontal: Spacing.four,
      paddingVertical: Spacing.three,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 44,
    },
    secondaryButtonText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    pressed: { opacity: 0.7 },
    linkStyle: { color: colors.accent, textDecorationLine: 'underline' },
  });
}
