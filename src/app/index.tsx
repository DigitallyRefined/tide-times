import { Link, Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { Spacing, MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  loadTideDatabase,
  nearestStations,
  refreshTideDatabase,
  searchStations,
  type TideDatabase,
} from '@/lib/tide-database';
import {
  addRecentStation,
  loadRecentStations,
  removeRecentStation,
  type RecentStation,
} from '@/lib/recent-stations';
import SearchInput from '@/components/search-input';
import { SettingsIcon } from '@/components/settings-icon';

type DbState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; db: TideDatabase };

interface StationInfo {
  id: string;
  name: string;
  country: string;
  timezone: string;
}

type Row =
  | { kind: 'station'; station: StationInfo; distanceKm: number | null }
  | { kind: 'recent'; station: RecentStation }
  | { kind: 'empty'; label: string };

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function SettingsButton() {
  const colors = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityLabel="Open settings"
      hitSlop={8}
      style={({ pressed }) => pressed && { opacity: 0.7 }}
      onPress={() => router.push('/settings')}
    >
      <SettingsIcon color={colors.accent} />
    </Pressable>
  );
}

export default function Index() {
  const colors = useTheme();
  const router = useRouter();

  const [dbState, setDbState] = useState<DbState>({ status: 'loading' });
  const [version, setVersion] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [recent, setRecent] = useState<RecentStation[]>([]);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadRecentStations()
      .then((list) => {
        if (active) setRecent(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadTideDatabase()
      .then((db) => {
        if (!active) return;
        setDbState({ status: 'ready', db });
        setVersion(db.meta.version);
        refreshTideDatabase().then((updated) => {
          if (!active || !updated) return;
          loadTideDatabase().then((fresh) => {
            if (!active) return;
            setDbState({ status: 'ready', db: fresh });
            setVersion(fresh.meta.version);
            setRows(null);
          });
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDbState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      active = false;
    };
  }, []);

  const searchedRows = useMemo<Row[] | null>(() => {
    if (dbState.status !== 'ready') return null;
    const q = query.trim();
    if (!q) return null;
    const hits = searchStations(dbState.db, q, 50);
    if (hits.length === 0) {
      return [{ kind: 'empty', label: 'No stations match that search.' }];
    }
    return hits.map((station) => ({ kind: 'station', station, distanceKm: null }));
  }, [dbState, query]);

  const recentRows = useMemo<Row[]>(
    () => recent.map((station) => ({ kind: 'recent', station })),
    [recent]
  );

  const shownRows: Row[] =
    rows ??
    searchedRows ??
    (recentRows.length > 0
      ? recentRows
      : [{ kind: 'empty', label: '' }]);

  const openStation = useCallback(
    async (station: StationInfo) => {
      try {
        setRecent(await addRecentStation(station));
      } catch {
        // Persistence is best-effort; still navigate.
      }
      router.push({ pathname: '/station/[id]', params: { id: station.id } });
    },
    [router]
  );

  const onDeleteRecent = useCallback(async (id: string) => {
    try {
      setRecent(await removeRecentStation(id));
    } catch {
      // ignore
    }
  }, []);

  const runLocationSearch = useCallback(async () => {
    setLocating(true);
    setLocationError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocationError('Location permission was denied. Allow access to search near you.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = position.coords;
      const db = dbState.status === 'ready' ? dbState.db : await loadTideDatabase();
      const nearest = nearestStations(db, latitude, longitude, 10);
      setRows(nearest.map((n) => ({ kind: 'station', station: n.station, distanceKm: n.distanceKm })));
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : 'Could not determine your location.');
    } finally {
      setLocating(false);
    }
  }, [dbState]);

  const clearLocationResults = useCallback(() => {
    setRows(null);
    setLocationError(null);
  }, []);

  const styles = useMemo(() => createStyles(colors), [colors]);

  if (dbState.status === 'loading') {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Tide Times', headerRight: () => <SettingsButton /> }} />
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.bodyText}>Downloading tide data…</Text>
      </View>
    );
  }

  if (dbState.status === 'error') {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Tide Times', headerRight: () => <SettingsButton /> }} />
        <Text style={[styles.bodyText, { color: colors.error }]}>{dbState.message}</Text>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={() => {
            setDbState({ status: 'loading' });
            loadTideDatabase()
              .then((db) => setDbState({ status: 'ready', db }))
              .catch((error: unknown) =>
                setDbState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
              );
          }}
        >
          <Text style={styles.primaryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const isLocationResults = rows !== null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Tide Times', headerRight: () => <SettingsButton /> }} />
      <View style={styles.safe}>
        <View style={styles.searchSection}>
          <SearchInput
            style={styles.searchInput}
            placeholder="Search by city, bay, or country"
            placeholderTextColor={colors.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          <Pressable
            style={({ pressed }) => [styles.locationButton, pressed && styles.pressed]}
            disabled={locating}
            onPress={runLocationSearch}
          >
            {locating ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.locationButtonText}>Use my location</Text>
            )}
          </Pressable>
          {locationError ? <Text style={[styles.errorText]}>{locationError}</Text> : null}
        </View>

        <View style={styles.resultsHeader}>
          <Text style={styles.secondaryText}>
            {isLocationResults
              ? 'Closest 10 stations to you'
              : query.trim()
                ? 'Matching stations'
                : recent.length > 0
                  ? 'Recent stations'
                  : `All reference stations (${dbState.db.stations.length})`}
          </Text>
          {isLocationResults ? (
            <Pressable onPress={clearLocationResults}>
              <Text style={[styles.linkText]}>Clear</Text>
            </Pressable>
          ) : null}
        </View>

        <FlatList
          data={shownRows}
          keyExtractor={(row, i) =>
            row.kind === 'empty' ? `e:${i}` : `${row.kind === 'recent' ? 'r' : 's'}:${row.station.id}`
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            if (item.kind === 'empty') {
              return <Text style={[styles.secondaryText, styles.emptyText]}>{item.label}</Text>;
            }
            if (item.kind === 'recent') {
              const { station } = item;
              return (
                <View style={styles.stationRow}>
                  <Pressable
                    style={({ pressed }) => [styles.stationMain, pressed && styles.pressed]}
                    onPress={() => openStation(station)}
                  >
                    <View style={styles.stationText}>
                      <Text style={styles.stationName} numberOfLines={2}>
                        {station.name}
                      </Text>
                      <Text style={styles.secondaryText} numberOfLines={1}>
                        {station.country} · {station.timezone}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Remove ${station.name} from recent stations`}
                    hitSlop={8}
                    style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
                    onPress={() => onDeleteRecent(station.id)}
                  >
                    <Text style={styles.deleteButtonText}>×</Text>
                  </Pressable>
                </View>
              );
            }
            const { station, distanceKm } = item;
            return (
              <Pressable
                style={({ pressed }) => [styles.stationRow, pressed && styles.pressed]}
                onPress={() => openStation(station)}
              >
                <View style={styles.stationText}>
                  <Text style={styles.stationName} numberOfLines={2}>
                    {station.name}
                  </Text>
                  <Text style={styles.secondaryText} numberOfLines={1}>
                    {station.country} · {station.timezone}
                  </Text>
                </View>
                {distanceKm !== null ? <Text style={styles.distanceText}>{formatDistance(distanceKm)}</Text> : null}
              </Pressable>
            );
          }}
        />

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Tide data: {version?.replace(/^v/, '') ?? 'unknown'} · updated via GitHub releases
          </Text>
          <Text style={styles.footerText}>
            Tide harmonic constituents from the{' '}
            <Link href="https://github.com/openwatersio/tide-database" target="_blank" style={styles.linkStyle}>
              Neaps tide database
            </Link>
          </Text>
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    container: { flex: 1 },
    center: { alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
    safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
    searchSection: { padding: Spacing.three, gap: Spacing.two },
    searchInput: {
      backgroundColor: colors.backgroundElement,
      color: colors.text,
      borderRadius: 12,
      paddingHorizontal: Spacing.three,
      paddingVertical: Spacing.three,
      fontSize: 16,
    },
    locationButton: {
      backgroundColor: colors.accent,
      borderRadius: 12,
      paddingVertical: Spacing.three,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
    },
    locationButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
    pressed: { opacity: 0.7 },
    errorText: { color: colors.error, fontSize: 13 },
    resultsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.three,
      paddingBottom: Spacing.two,
    },
    linkText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
    listContent: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four },
    stationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.backgroundElement,
      borderRadius: 12,
      padding: Spacing.three,
      marginBottom: Spacing.two,
      gap: Spacing.three,
    },
    stationMain: { flex: 1 },
    stationText: { flex: 1, gap: Spacing.half },
    stationName: { color: colors.text, fontSize: 16, fontWeight: '600' },
    secondaryText: { color: colors.textSecondary, fontSize: 13 },
    emptyText: { textAlign: 'center', marginTop: Spacing.five },
    distanceText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
    footer: { padding: Spacing.three, alignItems: 'center' },
    footerText: { color: colors.textSecondary, fontSize: 12 },
    linkStyle: { color: colors.accent, textDecorationLine: 'underline', fontSize: 12 },
    primaryButton: {
      backgroundColor: colors.accent,
      borderRadius: 12,
      paddingHorizontal: Spacing.four,
      paddingVertical: Spacing.three,
    },
    primaryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
    bodyText: { fontSize: 15 },
    deleteButton: {
      marginLeft: 'auto'
    },
    deleteButtonText: {
      fontSize: 24,
      color: "#666",
    },
  });
}
