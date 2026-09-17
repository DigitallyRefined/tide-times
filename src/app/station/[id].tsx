import {
  Link,
  Stack,
  useLocalSearchParams,
  type Href,
} from "expo-router";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  createTidePredictor,
  type Extreme,
  type TimelinePoint,
} from "@neaps/tide-predictor";
import { Spacing, MaxContentWidth, type ThemeColors } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import TideGraph from "@/components/tide-graph";
import { getStationById, loadTideDatabase } from "@/lib/tide-database";
import type { ReferenceStation } from "@/lib/tcd-parser";
import {
  formatLevel,
  formatStationDate,
  formatStationTime,
  formatStationTimeDate,
} from "@/lib/tide-time";
import { organicMapsUrl } from "@/lib/organic-maps";

interface StationData {
  station: ReferenceStation;
  extremes: Extreme[];
  timeline: TimelinePoint[];
  now: Date;
  nowLevel: number;
}

const WINDOW_MS = 24 * 3600 * 1000;
const BUFFER_MS = 2 * 3600 * 1000;
const FIDELITY_S = 600;

function computeStationData(station: ReferenceStation, now: Date): StationData {
  const predictor = createTidePredictor(station.constituents, {
    offset: station.datumOffset,
  });

  const extremesStart = new Date(now.getTime() - 36 * 3600 * 1000);
  const extremesEnd = new Date(now.getTime() + 72 * 3600 * 1000);
  const extremes = predictor.getExtremesPrediction({
    start: extremesStart,
    end: extremesEnd,
  });

  const lastExtreme = [...extremes]
    .reverse()
    .find((e) => e.time.getTime() <= now.getTime());

  const windowStart = lastExtreme
    ? new Date(lastExtreme.time.getTime() - BUFFER_MS)
    : new Date(now.getTime() - BUFFER_MS);

  const timeline = predictor.getTimelinePrediction({
    start: windowStart,
    end: new Date(windowStart.getTime() + WINDOW_MS),
    timeFidelity: FIDELITY_S,
  });

  const nowLevel = predictor.getWaterLevelAtTime({ time: now }).level;

  return { station, extremes, timeline, now, nowLevel };
}

type ScreenState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StationData };

function excerptName(name: string): string {
  const comma = name.indexOf(",");
  return comma > 0 ? name.slice(0, comma) : name;
}

export default function StationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useTheme();
  const [graphWidth, setGraphWidth] = useState(0);

  const [state, setState] = useState<ScreenState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(
    (now: Date) => {
      if (!id) {
        setState({ status: "error", message: "Missing station id." });
        return;
      }
      setState({ status: "loading" });
      loadTideDatabase()
        .then((db) => {
          const station = getStationById(db, id);
          if (!station) {
            setState({
              status: "error",
              message: "Station not found in the tide database.",
            });
            return;
          }
          setState({ status: "ready", data: computeStationData(station, now) });
        })
        .catch((error: unknown) =>
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
    },
    [id],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload(new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const styles = useMemo(() => createStyles(colors), [colors]);

  if (state.status === "loading") {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={[styles.bodyText, { color: colors.error }]}>
          {state.message}
        </Text>
        <Pressable
          style={styles.primaryButton}
          onPress={() => reload(new Date())}
        >
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const { station, extremes, timeline, now, nowLevel } = state.data;
  const unit = station.levelUnit === "feet" ? "feet" : "meters";
  const windowStart = timeline[0]?.time ?? now;

  const onRefresh = () => {
    setRefreshing(true);
    setState({
      status: "ready",
      data: computeStationData(station, new Date()),
    });
    setRefreshing(false);
  };

  const windowEnd = new Date(windowStart.getTime() + WINDOW_MS);
  const windowExtremes = extremes.filter(
    (e) =>
      e.time.getTime() >= windowStart.getTime() - 30 * 60 * 1000 &&
      e.time.getTime() <= windowEnd.getTime(),
  );

  const lastLow = [...extremes]
    .reverse()
    .find((e) => e.low && e.time.getTime() <= now.getTime());
  const lastHigh = [...extremes]
    .reverse()
    .find((e) => e.high && e.time.getTime() <= now.getTime());
  const nextHighs = extremes
    .filter((e) => e.high && e.time.getTime() >= now.getTime())
    .slice(0, 3);
  const nextLows = extremes
    .filter((e) => e.low && e.time.getTime() >= now.getTime())
    .slice(0, 3);

  const rows: {
    label: string;
    time: Date;
    level: number;
    high: boolean;
    next: boolean;
  }[] = [];
  if (lastHigh)
    rows.push({
      label: "Last high",
      time: lastHigh.time,
      level: lastHigh.level,
      high: true,
      next: false,
    });
  if (lastLow)
    rows.push({
      label: "Last low",
      time: lastLow.time,
      level: lastLow.level,
      high: false,
      next: false,
    });
  nextHighs.forEach((e, i) =>
    rows.push({
      label: i === 0 ? `Next high` : 'High',
      time: e.time,
      level: e.level,
      high: true,
      next: i === 0,
    }),
  );
  nextLows.forEach((e, i) =>
    rows.push({
      label:  i === 0 ? `Next low` : 'Low',
      time: e.time,
      level: e.level,
      high: false,
      next: i === 0,
    }),
  );

  rows.sort((a, b) => a.time.getTime() - b.time.getTime());

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
        />
      }
    >
      <Stack.Screen options={{ title: excerptName(station.name) }} />

      <View style={styles.card}>
        <Link
          href={organicMapsUrl(station.latitude, station.longitude, {
            name: 'Tide Monitoring Station',
          }) as Href}
          target="_blank"
          style={styles.stationLink}
        >
          {station.name}
        </Link>
        <Text style={styles.secondaryText}>
          {station.country} · {station.timezone}
        </Text>
        <Text style={styles.secondaryText}>
          Chart datum: {station.datum || "unknown"} ·{" "}
          {station.levelUnit === "feet" ? "feet" : "meters"}
        </Text>
      </View>

      <View
        style={{ ...styles.card, paddingHorizontal: 0 }}
        onLayout={(event) => setGraphWidth(event.nativeEvent.layout.width)}
      >
        <TideGraph
          points={timeline}
          extremes={windowExtremes}
          now={now}
          nowLevel={nowLevel}
          timezone={station.timezone}
          unit={unit}
          width={graphWidth}
          height={240}
          colors={colors}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Tides</Text>
        {rows.map((row, i) => (
          <Fragment key={`${row.label}-${row.time.getTime()}`}>
            {row.label.startsWith("Next") &&
            (i === 0 || !rows[i - 1].label.startsWith("Next")) ? (
              <View style={styles.divider} />
            ) : null}
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text
                style={[
                  styles.rowTime,
                  row.next ? styles.rowBold : null,
                ]}
              >
                {formatStationTimeDate(row.time, station.timezone)}
              </Text>
              <Text
                style={[
                  styles.rowLevel,
                  row.next ? styles.rowBold : null,
                  { color: row.high ? colors.accent : colors.text },
                ]}
              >
                {formatLevel(row.level, unit)}
              </Text>
            </View>
            {row.label.startsWith("Next") &&
            (i === rows.length - 1 ||
              !rows[i + 1].label.startsWith("Next")) ? (
              <View style={styles.divider} />
            ) : null}
          </Fragment>
        ))}
        {rows.length === 0 ? (
          <Text style={styles.secondaryText}>No tide events in range.</Text>
        ) : null}
      </View>

      <View style={styles.lastUpdated}>
        <Text style={styles.smallText}>
          Window: {formatStationDate(windowStart, station.timezone)}{" "}
          {formatStationTime(windowStart, station.timezone)} -{" "}
          {formatStationDate(windowEnd, station.timezone)}{" "}
          {formatStationTime(windowEnd, station.timezone)} ({station.timezone})
        </Text>
        <Text style={styles.smallText}>
          Tide harmonic constituents from the{' '}
          <Link href="https://github.com/openwatersio/tide-database" target="_blank" style={styles.linkStyle}>
            Neaps tide database
          </Link>
        </Text>
      </View>
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    center: {
      alignItems: "center",
      justifyContent: "center",
      padding: Spacing.four,
      gap: Spacing.three,
    },
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
    stationLink: {
      color: colors.accent,
      fontSize: 18,
      fontWeight: "700",
      textDecorationLine: "underline",
    },
    secondaryText: { color: colors.textSecondary, fontSize: 13 },
    sectionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
      marginBottom: Spacing.one,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: Spacing.one,
    },
    rowLabel: { color: colors.textSecondary, fontSize: 13, width: 96 },
    rowTime: { color: colors.text, fontSize: 13, flex: 1 },
    rowBold: { fontWeight: "700" },
    rowLevel: {
      fontSize: 14,
      fontWeight: "600",
      minWidth: 72,
      textAlign: "right",
    },
    divider: {
      borderTopWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.border,
      marginVertical: Spacing.one,
    },
    lastUpdated: { alignItems: "center" },
    smallText: { color: colors.textSecondary, fontSize: 11 },
    linkStyle: { color: colors.accent, textDecorationLine: 'underline', fontSize: 11 },
    bodyText: { fontSize: 15 },
    primaryButton: {
      backgroundColor: colors.accent,
      borderRadius: 12,
      paddingHorizontal: Spacing.four,
      paddingVertical: Spacing.three,
    },
    primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  });
}
