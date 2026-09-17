import { Platform } from "react-native";

const STORE_KEY = "recent-stations";
const MAX_RECENT = 50;

export interface RecentStation {
  id: string;
  name: string;
  country: string;
  timezone: string;
  selectedAt: number;
}

interface StationInput {
  id: string;
  name: string;
  country: string;
  timezone: string;
}

type FSFile = InstanceType<typeof import("expo-file-system").File>;

function nativeFile(): FSFile {
  // Lazy require so the module resolves on web. Aliased to avoid the DOM
  // global `File` interface name collision.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const module = require("expo-file-system") as typeof import("expo-file-system");
  const dir = new module.Directory(module.Paths.document, "tide-times");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return new module.File(dir.uri, `${STORE_KEY}.json`);
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === "web") {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(STORE_KEY);
  }
  const file = nativeFile();
  if (!file.exists) return null;
  return file.textSync();
}

async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORE_KEY, value);
    return;
  }
  const file = nativeFile();
  if (file.exists) file.delete();
  file.create();
  file.write(value);
}

function isRecentStation(value: unknown): value is RecentStation {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.country === "string" &&
    typeof v.timezone === "string" &&
    typeof v.selectedAt === "number"
  );
}

async function readAll(): Promise<RecentStation[]> {
  const raw = await readRaw();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentStation).sort((a, b) => b.selectedAt - a.selectedAt);
  } catch {
    return [];
  }
}

export async function loadRecentStations(): Promise<RecentStation[]> {
  return readAll();
}

export async function addRecentStation(station: StationInput): Promise<RecentStation[]> {
  const existing = await readAll();
  const entry: RecentStation = { ...station, selectedAt: Date.now() };
  const next = [entry, ...existing.filter((s) => s.id !== station.id)].slice(0, MAX_RECENT);
  await writeRaw(JSON.stringify(next));
  return next;
}

export async function removeRecentStation(id: string): Promise<RecentStation[]> {
  const next = (await readAll()).filter((s) => s.id !== id);
  await writeRaw(JSON.stringify(next));
  return next;
}

export async function clearRecentStations(): Promise<void> {
  await writeRaw("[]");
}
