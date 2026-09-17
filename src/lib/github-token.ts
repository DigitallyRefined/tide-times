import { Platform } from "react-native";

const TOKEN_KEY = "github-access-token";

type SecureStoreModule = typeof import("expo-secure-store");

// Lazy require so the module (and its native binary) is skipped on web, where it
// has no implementation. The token is only ever used against the GitHub API on
// native builds; the web build loads the bundled snapshot from public/.
function secureStore(): SecureStoreModule | null {
  if (Platform.OS === "web") return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const module = require("expo-secure-store") as SecureStoreModule;
  return module;
}

// Stored with expo-secure-store: an Android Keystore-encrypted SharedPreferences
// entry (excluded from Auto Backup) or an iOS Keychain item.
export async function loadGitHubToken(): Promise<string | null> {
  const store = secureStore();
  if (!store) return null;
  try {
    return await store.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function saveGitHubToken(token: string): Promise<void> {
  const store = secureStore();
  if (!store) return;
  await store.setItemAsync(TOKEN_KEY, token.trim());
}

export async function deleteGitHubToken(): Promise<void> {
  const store = secureStore();
  if (!store) return;
  await store.deleteItemAsync(TOKEN_KEY);
}