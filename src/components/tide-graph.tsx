import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { Spacing, type ThemeColors } from '@/constants/theme';

export interface TidePoint {
  time: Date;
  level: number;
}

export interface TideExtreme {
  time: Date;
  level: number;
  high: boolean;
  low: boolean;
}

interface TideGraphProps {
  points: TidePoint[];
  extremes: TideExtreme[];
  now: Date;
  nowLevel: number;
  timezone: string;
  unit: string;
  width: number;
  height: number;
  colors: ThemeColors;
}

const PAD_LEFT = 42;
const PAD_RIGHT = 10;
const PAD_TOP = 16;
const PAD_BOTTOM = 24;

function niceTicks(min: number, max: number, targetCount = 4): number[] {
  const span = max - min;
  if (span === 0) return [min];
  const rawStep = span / Math.max(1, targetCount);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step: number;
  if (norm < 1.5) step = 1 * mag;
  else if (norm < 3.5) step = 2 * mag;
  else if (norm < 7.5) step = 5 * mag;
  else step = 10 * mag;

  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

export default function TideGraph({
  points,
  extremes,
  now,
  nowLevel,
  timezone,
  unit,
  width,
  height,
  colors,
}: TideGraphProps) {
  const bounds = useMemo(() => {
    if (points.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      if (p.level < min) min = p.level;
      if (p.level > max) max = p.level;
    }
    const pad = Math.max((max - min) * 0.12, 0.20);
    return { min: min - pad, max: max + pad };
  }, [points]);

  const t0 = points.length > 0 ? points[0].time.getTime() : 0;
  const t1 = points.length > 0 ? points[points.length - 1].time.getTime() : 0;

  if (!bounds || points.length < 2 || width <= 0) {
    return <View style={[styles.placeholder, { height, width }]} />;
  }

  const chartW = width - PAD_LEFT - PAD_RIGHT;
  const chartH = height - PAD_TOP - PAD_BOTTOM;

  const x = (t: number) => PAD_LEFT + (chartW * (t - t0)) / (t1 - t0);
  const y = (level: number) => {
    const clamped = Math.min(Math.max(level, bounds.min), bounds.max);
    return PAD_TOP + chartH - (chartH * (clamped - bounds.min)) / (bounds.max - bounds.min);
  };

  const polyline = points.map((p) => `${x(p.time.getTime()).toFixed(1)},${y(p.level).toFixed(1)}`).join(' ');

  const yTicks = niceTicks(bounds.min, bounds.max);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => new Date(t0 + f * (t1 - t0)));

  const nowX = x(now.getTime());

  const labeledExtremes: TideExtreme[] = [];
  let prevX = -Infinity;
  for (const e of extremes) {
    const ex = x(e.time.getTime());
    if (e.time.getTime() < t0 - 30 * 60 * 1000 || e.time.getTime() > t1) continue;
    if (ex - prevX < 42) continue;
    prevX = ex;
    labeledExtremes.push(e);
  }

  const nowFmt = new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit' }).format(now);

  return (
    <View style={{ width }}>
      <Svg width={width} height={height}>
        {yTicks.map((tickLevel) => (
          <G key={`y${tickLevel}`}>
            <Line
              x1={PAD_LEFT}
              y1={y(tickLevel)}
              x2={width - PAD_RIGHT}
              y2={y(tickLevel)}
              stroke={colors.border}
              strokeWidth={1}
            />
            <SvgText
              x={PAD_LEFT - 6}
              y={y(tickLevel) + 4}
              fontSize={10}
              fill={colors.textSecondary}
              fontFamily="sans-serif"
              textAnchor="end"
            >
              {tickLevel.toFixed(1)}
            </SvgText>
          </G>
        ))}

        {xTicks.map((t, i) => (
          <SvgText
            key={`x${i}`}
            x={x(t.getTime())}
            y={height - 8}
            fontSize={10}
            fill={colors.textSecondary}
            fontFamily="sans-serif"
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
          >
            {new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit' }).format(t)}
          </SvgText>
        ))}

        <Polyline points={polyline} fill="none" stroke={colors.accent} strokeWidth={2} />

        {labeledExtremes.map((e) => {
          const ex = x(e.time.getTime());
          const top = e.high ? y(e.level) - 6 : Math.min(y(e.level) + 14, height - PAD_BOTTOM + 12);
          const label = `${e.high ? 'High' : 'Low'} ${formatExtremeLevel(e.level, unit)}`;
          return (
            <SvgText
              key={`${e.time.getTime()}`}
              x={ex}
              y={top}
              fontSize={10}
              fontWeight="600"
              fill={e.high ? colors.accent : colors.textSecondary}
              fontFamily="sans-serif"
              textAnchor="middle"
            >
              {label}
            </SvgText>
          );
        })}

        <Line
          x1={nowX}
          y1={PAD_TOP}
          x2={nowX}
          y2={height - PAD_BOTTOM}
          stroke={colors.text}
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <SvgText x={nowX + 4} y={PAD_TOP + 10} fontSize={10} fontWeight="600" fill={colors.text} fontFamily="sans-serif">
          Now {nowFmt}
        </SvgText>
        <Circle cx={nowX} cy={y(nowLevel)} r={4} fill={colors.text} />
        <Line
          x1={PAD_LEFT}
          y1={y(nowLevel)}
          x2={width - PAD_RIGHT}
          y2={y(nowLevel)}
          stroke={colors.text}
          strokeWidth={1}
          strokeDasharray="2 6"
          opacity={0.4}
        />
      </Svg>
      <Text style={[styles.unitLabel, { color: colors.textSecondary }]}>
        Levels relative to chart datum
      </Text>
    </View>
  );
}

function formatExtremeLevel(level: number, unit: string): string {
  if (unit === 'feet') return `${level.toFixed(2)} ft`;
  return `${level.toFixed(2)} m`;
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: 'transparent' },
  unitLabel: { fontSize: 11, textAlign: 'right', marginTop: Spacing.half, paddingRight: Spacing.two },
});
