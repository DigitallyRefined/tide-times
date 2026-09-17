import { Platform } from "react-native";
import {
  parseTcdHeader,
  parseReferenceStations,
  TcdError,
  type ReferenceStation,
  type TcdHeader,
} from "./tcd-parser";
import { loadGitHubToken } from "./github-token";

export interface TideDatabaseMeta {
  version: string;
  assetName: string;
  url: string;
  downloadedAt: string;
}

export interface TideDatabase {
  data: Uint8Array;
  header: TcdHeader;
  stations: ReferenceStation[];
  meta: TideDatabaseMeta;
}

const RELEASES_URL =
  "https://api.github.com/repos/openwatersio/tide-database/releases/latest";
const ASSET_PATTERN = /^neaps-\d{8}-metric\.tcd$/;
const DATA_KEY = "stations.tcd";
const META_KEY = "meta.json";
const IDB_NAME = "tide-times";
const IDB_STORE = "files";

// GitHub release assets are served without CORS headers, so a browser cannot
// download them directly. To keep the web build working, the current snapshot
// is shipped in public/ and fetched same-origin. Native apps still auto-update
// from GitHub. Bump these when bundling a newer neaps release.
const WEB_TCD_URL = "/neaps-metric.tcd";
const WEB_TCD_VERSION = "web-dev";

interface ReleaseAsset {
  id: number;
  name: string;
  browser_download_url: string;
  size: number;
}

interface ReleaseInfo {
  tag_name: string;
  assets: ReleaseAsset[];
}

let cached: TideDatabase | null = null;
let loading: Promise<TideDatabase> | null = null;

// ── Platform adapter interface ───────────────────────────────────────────────

interface StorageAdapter {
  loadMeta(): Promise<TideDatabaseMeta | null>;
  saveMeta(meta: TideDatabaseMeta): Promise<void>;
  loadData(): Promise<Uint8Array | null>;
  saveData(data: Uint8Array): Promise<void>;
}

// ── Native storage (expo-file-system) ────────────────────────────────────────

function createNativeAdapter(): StorageAdapter {
  // Lazy require so the module resolves on web without crashing.
  // Aliased to avoid TypeScript's global DOM `File` interface.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const module = require("expo-file-system") as typeof import("expo-file-system");
  const FSFile = module.File;
  const FSDirectory = module.Directory;
  const FSPaths = module.Paths;

  function ensureDir(): void {
    const dir = new FSDirectory(FSPaths.document, "tide-times");
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  }

  function file(name: string): InstanceType<typeof FSFile> {
    return new FSFile(new FSDirectory(FSPaths.document, "tide-times").uri, name);
  }

  return {
    loadMeta: async () => {
      const f = file(META_KEY);
      if (!f.exists) return null;
      try {
        const parsed = JSON.parse(f.textSync());
        if (typeof parsed?.version === "string" && typeof parsed?.assetName === "string")
          return {
            version: parsed.version,
            assetName: parsed.assetName,
            url: typeof parsed.url === "string" ? parsed.url : "",
            downloadedAt: typeof parsed.downloadedAt === "string" ? parsed.downloadedAt : "",
          };
      } catch {
        // fall through
      }
      return null;
    },

    saveMeta: async (meta) => {
      ensureDir();
      const f = file(META_KEY);
      if (f.exists) f.delete();
      f.create();
      f.write(JSON.stringify(meta));
    },

    loadData: async () => {
      const f = file(DATA_KEY);
      if (!f.exists) return null;
      return f.bytesSync();
    },

    saveData: async (data) => {
      ensureDir();
      const f = file(DATA_KEY);
      if (f.exists) f.delete();
      f.write(data);
    },
  };
}

// ── Web storage (IndexedDB) ──────────────────────────────────────────────────

function openIdb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new TcdError("IndexedDB is not available in this environment"));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new TcdError("IndexedDB open failed"));
  });
}

async function idbGet(key: string): Promise<Uint8Array | null> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result instanceof Uint8Array ? req.result : null);
    req.onerror = () => reject(new TcdError("IndexedDB read failed"));
  });
}

async function idbGetText(key: string): Promise<string | null> {
  const buf = await idbGet(key);
  return buf ? new TextDecoder().decode(buf) : null;
}

async function idbPut(key: string, value: Uint8Array): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new TcdError("IndexedDB write failed"));
  });
}

async function idbPutText(key: string, text: string): Promise<void> {
  await idbPut(key, new TextEncoder().encode(text));
}

function createWebAdapter(): StorageAdapter {
  return {
    loadMeta: async () => {
      const raw = await idbGetText(META_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.version === "string" && typeof parsed?.assetName === "string")
          return {
            version: parsed.version,
            assetName: parsed.assetName,
            url: typeof parsed.url === "string" ? parsed.url : "",
            downloadedAt: typeof parsed.downloadedAt === "string" ? parsed.downloadedAt : "",
          };
      } catch {
        // fall through
      }
      return null;
    },

    saveMeta: (meta) => idbPutText(META_KEY, JSON.stringify(meta)),

    loadData: () => idbGet(DATA_KEY),

    saveData: (data) => idbPut(DATA_KEY, data),
  };
}

function getStorage(): StorageAdapter {
  if (Platform.OS === "web") return createWebAdapter();
  return createNativeAdapter();
}

// ── GitHub API ───────────────────────────────────────────────────────────────

// A user-supplied GitHub access token (see src/lib/github-token.ts) is sent as a
// Bearer credential so the shared mobile ISP's IP address is not subject to the
// unauthenticated rate limit (60 requests/hour), which otherwise returns HTTP 403.
async function authHeaders(): Promise<Record<string, string>> {
  const token = await loadGitHubToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function rateLimitHint(status: number): string {
  if (status !== 403) return "";
  return " GitHub is rate-limiting this connection; open Settings and add a GitHub access token to raise the limit.";
}

async function fetchLatestRelease(): Promise<ReleaseInfo> {
  const res = await fetch(RELEASES_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "tide-times",
      ...(await authHeaders()),
    },
  });
  if (!res.ok)
    throw new TcdError(
      `GitHub releases request failed (HTTP ${res.status})${rateLimitHint(res.status)}`
    );
  const json = (await res.json()) as ReleaseInfo;
  if (!json?.tag_name) throw new TcdError("GitHub release response missing tag_name");
  return json;
}

function pickMetricAsset(release: ReleaseInfo): ReleaseAsset {
  const asset = release.assets.find((a) => ASSET_PATTERN.test(a.name));
  if (!asset)
    throw new TcdError(`no metric .tcd asset found in release ${release.tag_name}`);
  return asset;
}

function assetDownloadUrl(asset: ReleaseAsset): string {
  // The github.com/.../releases/download/... redirect chain lacks CORS headers.
  // The api.github.com releases/assets endpoint sends Access-Control-Allow-Origin: *
  // and redirects to release-assets.githubusercontent.com, which is also CORS-enabled.
  return `https://api.github.com/repos/openwatersio/tide-database/releases/assets/${asset.id}`;
}

async function fetchBinaryAsset(asset: ReleaseAsset): Promise<Uint8Array> {
  const res = await fetch(assetDownloadUrl(asset), {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "tide-times",
      ...(await authHeaders()),
    },
  });
  if (!res.ok)
    throw new TcdError(`download failed (HTTP ${res.status})${rateLimitHint(res.status)}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// ── Parse + validate ─────────────────────────────────────────────────────────

function parseData(data: Uint8Array, meta: TideDatabaseMeta): TideDatabase {
  const header = parseTcdHeader(data);
  if (!header.crcValid) throw new TcdError("tide data failed checksum validation");
  const stations = parseReferenceStations(data, header);
  return { data, header, stations, meta };
}

// ── Core logic ───────────────────────────────────────────────────────────────

async function ensureStored(adapter: StorageAdapter): Promise<TideDatabaseMeta> {
  const existingMeta = await adapter.loadMeta();
  const existingData = existingMeta ? await adapter.loadData() : null;

  if (existingMeta && existingData) return existingMeta;

  let data: Uint8Array;
  let nextMeta: TideDatabaseMeta;

  if (Platform.OS === "web") {
    // GitHub release assets are not browser-readable (no CORS), so the web
    // build loads the snapshot shipped in public/.
    const res = await fetch(WEB_TCD_URL);
    if (!res.ok)
      throw new TcdError(`bundled tide data request failed (HTTP ${res.status})`);
    data = new Uint8Array(await res.arrayBuffer());
    nextMeta = {
      version: WEB_TCD_VERSION,
      assetName: WEB_TCD_URL.split("/").pop() ?? WEB_TCD_URL,
      url: WEB_TCD_URL,
      downloadedAt: new Date().toISOString(),
    };
  } else {
    const release = await fetchLatestRelease();
    const asset = pickMetricAsset(release);
    nextMeta = {
      version: release.tag_name,
      assetName: asset.name,
      url: assetDownloadUrl(asset),
      downloadedAt: new Date().toISOString(),
    };

    if (existingMeta && existingMeta.assetName === nextMeta.assetName && existingData) {
      return existingMeta;
    }

    data = await fetchBinaryAsset(asset);
  }

  await adapter.saveData(data);
  await adapter.saveMeta(nextMeta);
  return nextMeta;
}

export function loadTideDatabase(): Promise<TideDatabase> {
  if (cached) return Promise.resolve(cached);
  if (loading) return loading;

  const adapter = getStorage();

  loading = (async () => {
    try {
      const meta = await ensureStored(adapter);
      const data = await adapter.loadData();
      if (!data) throw new TcdError("tide data file is missing after download");
      return parseData(data, meta);
    } finally {
      loading = null;
    }
  })();

  return loading;
}

export async function refreshTideDatabase(): Promise<boolean> {
  if (Platform.OS === "web") {
    // The web build uses the bundled snapshot in public/; updating it requires
    // a rebuild (GitHub release assets are not browser-downloadable).
    return false;
  }
  const current = await loadTideDatabase();
  try {
    const release = await fetchLatestRelease();
    if (release.tag_name === current.meta.version) return false;

    const asset = pickMetricAsset(release);
    const adapter = getStorage();
    const nextMeta: TideDatabaseMeta = {
      version: release.tag_name,
      assetName: asset.name,
      url: assetDownloadUrl(asset),
      downloadedAt: new Date().toISOString(),
    };

    const data = await fetchBinaryAsset(asset);
    await adapter.saveData(data);
    await adapter.saveMeta(nextMeta);
    cached = parseData(data, nextMeta);
    return true;
  } catch {
    return false;
  }
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function getStationById(
  db: TideDatabase,
  id: string
): ReferenceStation | undefined {
  return db.stations.find((s) => s.id === id);
}

export function searchStations(
  db: TideDatabase,
  query: string,
  limit = 50
): ReferenceStation[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return db.stations
    .filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.country.toLowerCase().includes(q)
    )
    .slice(0, limit);
}

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearestStations(
  db: TideDatabase,
  latitude: number,
  longitude: number,
  count = 10
): { station: ReferenceStation; distanceKm: number }[] {
  return db.stations
    .map((station) => ({
      station,
      distanceKm: haversineDistanceKm(
        latitude,
        longitude,
        station.latitude,
        station.longitude
      ),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, count);
}