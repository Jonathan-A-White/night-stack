import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { db } from '../../db';
import { toLocalDateString } from '../../utils';
import { SubNav } from './Dashboard';
import type { NightLog, BeddingItem, ClothingItem, EveningFlag } from '../../types';

type OutcomeKey = 'just_right' | 'no_major_wake';
type IntakeKey = EveningFlag['type'] | 'alcohol';
type NonMatchMode = 'hide' | 'dim';

interface Filters {
  outcomes: OutcomeKey[];
  intake: IntakeKey[];
  nonMatchMode: NonMatchMode;
  startDate: string;
  endDate: string;
}

const STORAGE_KEY = 'thermal-fit-filters';
const DEFAULT_DAYS_BACK = 90;

const OUTCOME_LABELS: Record<OutcomeKey, string> = {
  just_right: 'Just right',
  no_major_wake: 'No major wake-ups',
};

const INTAKE_LABELS: Record<IntakeKey, string> = {
  overate: 'Overate',
  high_salt: 'High salt',
  nitrates: 'Nitrates',
  questionable_food: 'Questionable food',
  late_meal: 'Late meal',
  alcohol: 'Alcohol',
  custom: 'Custom flag',
};
const INTAKE_KEYS: IntakeKey[] = [
  'overate', 'high_salt', 'nitrates', 'questionable_food', 'late_meal', 'alcohol',
];

const COLOR_JUST_RIGHT = '#4caf87';
const COLOR_NO_WAKE = '#e2b714';
const COLOR_BASE = '#8888bb';
const COLOR_DIMMED = '#44445a';

function defaultFilters(): Filters {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - DEFAULT_DAYS_BACK);
  return {
    outcomes: [],
    intake: [],
    nonMatchMode: 'dim',
    startDate: toLocalDateString(start),
    endDate: toLocalDateString(end),
  };
}

function loadFilters(): Filters {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultFilters();
    const parsed = JSON.parse(raw) as Partial<Filters>;
    const base = defaultFilters();
    return {
      outcomes: Array.isArray(parsed.outcomes) ? (parsed.outcomes as OutcomeKey[]) : base.outcomes,
      intake: Array.isArray(parsed.intake) ? (parsed.intake as IntakeKey[]) : base.intake,
      nonMatchMode: parsed.nonMatchMode === 'hide' ? 'hide' : 'dim',
      startDate: typeof parsed.startDate === 'string' ? parsed.startDate : base.startDate,
      endDate: typeof parsed.endDate === 'string' ? parsed.endDate : base.endDate,
    };
  } catch {
    return defaultFilters();
  }
}

function getRoomMin(log: NightLog): number | null {
  const timeline = log.roomTimeline;
  if (!timeline || timeline.length === 0) return null;
  let min = Infinity;
  for (const r of timeline) {
    if (r.tempF < min) min = r.tempF;
  }
  return Number.isFinite(min) ? min : null;
}

function warmthOrDefault(item: { warmth: number | null } | undefined): number {
  if (!item) return 1;
  return item.warmth ?? 1;
}

function computeWarmthScore(
  log: NightLog,
  beddingById: Map<string, BeddingItem>,
  clothingById: Map<string, ClothingItem>,
): number {
  let total = 0;
  for (const id of log.bedding) total += warmthOrDefault(beddingById.get(id));
  for (const id of log.clothing) total += warmthOrDefault(clothingById.get(id));
  return total;
}

function isJustRight(log: NightLog): boolean {
  return log.thermalComfort === 'just_right';
}

/**
 * No major wake-ups = every logged wake event was recovered from.
 * An empty wakeUpEvents array qualifies. This matches the user's
 * interpretation of last night (too_hot but fell back asleep → "not major").
 */
function hasNoMajorWake(log: NightLog): boolean {
  if (log.wakeUpEvents.length === 0) return true;
  return log.wakeUpEvents.every((ev) => ev.fellBackAsleep === 'yes');
}

function flagActive(log: NightLog, key: IntakeKey): boolean {
  if (key === 'alcohol') return log.eveningIntake.alcohol !== null;
  return log.eveningIntake.flags.some((f) => f.type === key && f.active);
}

export function ThermalFit() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(() => loadFilters());

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // sessionStorage can throw in private modes — non-fatal.
    }
  }, [filters]);

  const logs = useLiveQuery(
    () => db.nightLogs
      .where('date')
      .between(filters.startDate, filters.endDate, true, true)
      .toArray(),
    [filters.startDate, filters.endDate],
  );
  const bedding = useLiveQuery(() => db.beddingItems.toArray(), []);
  const clothing = useLiveQuery(() => db.clothingItems.toArray(), []);

  const beddingById = useMemo(() => {
    const m = new Map<string, BeddingItem>();
    for (const b of bedding ?? []) m.set(b.id, b);
    return m;
  }, [bedding]);

  const clothingById = useMemo(() => {
    const m = new Map<string, ClothingItem>();
    for (const c of clothing ?? []) m.set(c.id, c);
    return m;
  }, [clothing]);

  // Nag if any active item is missing a warmth value — the score treats
  // missing as 1, which can silently bias the chart. Surface it so the
  // user can set the real value in Settings.
  const missingWarmthCount = useMemo(() => {
    let n = 0;
    for (const b of bedding ?? []) if (b.isActive && b.warmth === null) n++;
    for (const c of clothing ?? []) if (c.isActive && c.warmth === null) n++;
    return n;
  }, [bedding, clothing]);

  const points = useMemo(() => {
    if (!logs || !bedding || !clothing) return [];
    const out: {
      date: string;
      x: number;
      y: number;
      justRight: boolean;
      noMajorWake: boolean;
      matchesIntake: boolean;
      thermalComfort: NightLog['thermalComfort'];
      wakeUpCount: number;
    }[] = [];
    for (const log of logs) {
      const x = getRoomMin(log);
      if (x === null) continue;
      const y = computeWarmthScore(log, beddingById, clothingById);
      // Intake filter: AND — every enabled intake flag must be active on this night.
      const matchesIntake = filters.intake.every((k) => flagActive(log, k));
      out.push({
        date: log.date,
        x,
        y,
        justRight: isJustRight(log),
        noMajorWake: hasNoMajorWake(log),
        matchesIntake,
        thermalComfort: log.thermalComfort,
        wakeUpCount: log.wakeUpEvents.length,
      });
    }
    return out;
  }, [logs, bedding, clothing, beddingById, clothingById, filters.intake]);

  // Split points into series based on outcome chips + intake filter + non-match mode.
  const series = useMemo(() => {
    const intakeMatching = points.filter((p) => p.matchesIntake);
    const intakeNonMatching = points.filter((p) => !p.matchesIntake);
    const outcomeActive = filters.outcomes.length > 0;

    // "Non-match" set = nights that pass intake but fail the active outcome chips.
    const nonMatchOutcome = (p: typeof points[number]) => {
      if (!outcomeActive) return false;
      const matchJust = filters.outcomes.includes('just_right') && p.justRight;
      const matchWake = filters.outcomes.includes('no_major_wake') && p.noMajorWake;
      // A point is "outcome-matching" if ANY active outcome chip matches it
      // (so with both chips on, the two series overlay — union of matches).
      return !(matchJust || matchWake);
    };

    const justRight = intakeMatching.filter(
      (p) => filters.outcomes.includes('just_right') && p.justRight,
    );
    const noWake = intakeMatching.filter(
      (p) => filters.outcomes.includes('no_major_wake') && p.noMajorWake,
    );
    const base = outcomeActive
      ? []
      : intakeMatching;
    const outcomeMismatch = outcomeActive
      ? intakeMatching.filter(nonMatchOutcome)
      : [];

    return {
      base,
      justRight,
      noWake,
      outcomeMismatch,
      intakeMismatch: intakeNonMatching,
    };
  }, [points, filters.outcomes]);

  const toggleOutcome = (k: OutcomeKey) => {
    setFilters((f) => ({
      ...f,
      outcomes: f.outcomes.includes(k)
        ? f.outcomes.filter((x) => x !== k)
        : [...f.outcomes, k],
    }));
  };

  const toggleIntake = (k: IntakeKey) => {
    setFilters((f) => ({
      ...f,
      intake: f.intake.includes(k)
        ? f.intake.filter((x) => x !== k)
        : [...f.intake, k],
    }));
  };

  const clearFilters = () => setFilters(defaultFilters());

  const handlePointClick = (payload: { date?: string } | undefined) => {
    if (!payload?.date) return;
    navigate(`/morning?date=${payload.date}`);
  };

  if (!logs || !bedding || !clothing) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  const showDimmed = filters.nonMatchMode === 'dim';
  const renderedCount =
    series.base.length + series.justRight.length + series.noWake.length
    + (showDimmed ? series.outcomeMismatch.length + series.intakeMismatch.length : 0);

  return (
    <div>
      <div className="page-header">
        <h1>Insights</h1>
        <p className="subtitle">Blankets vs room low — filtered by outcome and intake</p>
      </div>

      <SubNav active="thermal-fit" />

      {missingWarmthCount > 0 && (
        <div className="card" style={{ borderLeft: '3px solid #e2b714' }}>
          <div className="card-title">Set item warmth</div>
          <p className="text-secondary" style={{ margin: '4px 0 8px' }}>
            {missingWarmthCount} active bedding/clothing item{missingWarmthCount === 1 ? '' : 's'}
            {' '}don't have a warmth rating yet. Unrated items are treated as 1 (lightest),
            which can bias the warmth score downward.
          </p>
          <div className="flex gap-8">
            <Link className="btn btn-sm btn-primary" to="/settings/bedding">Set bedding</Link>
            <Link className="btn btn-sm btn-primary" to="/settings/clothing">Set clothing</Link>
          </div>
        </div>
      )}

      {/* Date range */}
      <div className="card">
        <div className="card-title">Date range</div>
        <div className="flex gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="date"
            className="form-input"
            style={{ flex: '1 1 140px' }}
            value={filters.startDate}
            max={filters.endDate}
            onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
          />
          <span className="text-secondary">to</span>
          <input
            type="date"
            className="form-input"
            style={{ flex: '1 1 140px' }}
            value={filters.endDate}
            min={filters.startDate}
            onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
          />
        </div>
      </div>

      {/* Outcome chips */}
      <div className="card">
        <div className="card-title">Outcome</div>
        <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
          {(Object.keys(OUTCOME_LABELS) as OutcomeKey[]).map((k) => {
            const on = filters.outcomes.includes(k);
            const color = k === 'just_right' ? COLOR_JUST_RIGHT : COLOR_NO_WAKE;
            return (
              <button
                key={k}
                className={`btn btn-sm ${on ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => toggleOutcome(k)}
                style={on ? { background: color, borderColor: color, color: '#0b0b18' } : undefined}
              >
                {OUTCOME_LABELS[k]}
              </button>
            );
          })}
        </div>
        <div className="text-secondary" style={{ fontSize: 12, marginTop: 8 }}>
          Both chips = two overlaid series (a night can belong to both).
        </div>
      </div>

      {/* Intake chips */}
      <div className="card">
        <div className="card-title">Intake filter (AND)</div>
        <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
          {INTAKE_KEYS.map((k) => {
            const on = filters.intake.includes(k);
            return (
              <button
                key={k}
                className={`btn btn-sm ${on ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => toggleIntake(k)}
              >
                {INTAKE_LABELS[k]}
              </button>
            );
          })}
        </div>
        <div className="text-secondary" style={{ fontSize: 12, marginTop: 8 }}>
          Each enabled chip narrows the set — shows only nights with all of those flags active.
        </div>
      </div>

      {/* Non-match mode */}
      <div className="card">
        <div className="card-title">Non-matching nights</div>
        <div className="flex gap-8">
          <button
            className={`btn btn-sm ${filters.nonMatchMode === 'dim' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilters((f) => ({ ...f, nonMatchMode: 'dim' }))}
          >
            Dim to gray
          </button>
          <button
            className={`btn btn-sm ${filters.nonMatchMode === 'hide' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilters((f) => ({ ...f, nonMatchMode: 'hide' }))}
          >
            Hide
          </button>
          <button
            className="btn btn-sm btn-secondary"
            style={{ marginLeft: 'auto' }}
            onClick={clearFilters}
          >
            Reset filters
          </button>
        </div>
      </div>

      {/* Chart */}
      {renderedCount > 0 ? (
        <div className="card">
          <div className="card-title">Warmth score vs room low</div>
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 10, right: 10, bottom: 30, left: 10 }}>
              <CartesianGrid stroke="#333355" strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="x"
                name="Room low (°F)"
                domain={['dataMin - 1', 'dataMax + 1']}
                tick={{ fill: '#9999aa', fontSize: 11 }}
                axisLine={{ stroke: '#333355' }}
                tickLine={false}
                label={{ value: 'Room low (°F)', position: 'bottom', fill: '#9999aa', fontSize: 11, offset: 10 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Warmth score"
                domain={['dataMin - 1', 'dataMax + 1']}
                tick={{ fill: '#9999aa', fontSize: 11 }}
                axisLine={{ stroke: '#333355' }}
                tickLine={false}
                width={40}
                label={{ value: 'Warmth score', angle: -90, position: 'insideLeft', fill: '#9999aa', fontSize: 11 }}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                contentStyle={{
                  background: '#1a1a2e',
                  border: '1px solid #333355',
                  borderRadius: 8,
                  color: '#e8e8ed',
                }}
                content={(props) => {
                  type PayloadRow = {
                    payload: typeof points[number];
                  };
                  const payload = (props as unknown as { payload?: readonly PayloadRow[] }).payload;
                  if (!payload || payload.length === 0) return null;
                  const p = payload[0].payload;
                  return (
                    <div style={{ padding: 8 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.date}</div>
                      <div>Room low: {p.x.toFixed(1)}°F</div>
                      <div>Warmth score: {p.y}</div>
                      <div style={{ opacity: 0.8 }}>
                        {p.thermalComfort ?? 'no label'} · {p.wakeUpCount} wake-up{p.wakeUpCount === 1 ? '' : 's'}
                      </div>
                      <div style={{ opacity: 0.6, fontSize: 11, marginTop: 4 }}>
                        Click to open morning
                      </div>
                    </div>
                  );
                }}
              />
              {showDimmed && series.intakeMismatch.length > 0 && (
                <Scatter
                  data={series.intakeMismatch}
                  fill={COLOR_DIMMED}
                  shape="circle"
                  onClick={(d) => handlePointClick(d as { date?: string })}
                  style={{ cursor: 'pointer' }}
                />
              )}
              {showDimmed && series.outcomeMismatch.length > 0 && (
                <Scatter
                  data={series.outcomeMismatch}
                  fill={COLOR_DIMMED}
                  shape="circle"
                  onClick={(d) => handlePointClick(d as { date?: string })}
                  style={{ cursor: 'pointer' }}
                />
              )}
              {series.base.length > 0 && (
                <Scatter
                  data={series.base}
                  fill={COLOR_BASE}
                  shape="circle"
                  onClick={(d) => handlePointClick(d as { date?: string })}
                  style={{ cursor: 'pointer' }}
                />
              )}
              {series.noWake.length > 0 && (
                <Scatter
                  name="No major wake-ups"
                  data={series.noWake}
                  fill={COLOR_NO_WAKE}
                  shape="circle"
                  onClick={(d) => handlePointClick(d as { date?: string })}
                  style={{ cursor: 'pointer' }}
                />
              )}
              {series.justRight.length > 0 && (
                <Scatter
                  name="Just right"
                  data={series.justRight}
                  fill={COLOR_JUST_RIGHT}
                  shape="circle"
                  onClick={(d) => handlePointClick(d as { date?: string })}
                  style={{ cursor: 'pointer' }}
                />
              )}
            </ScatterChart>
          </ResponsiveContainer>

          {/* Legend + counts */}
          <div className="flex gap-8" style={{ flexWrap: 'wrap', marginTop: 8, fontSize: 12 }}>
            {filters.outcomes.length === 0 && (
              <LegendSwatch color={COLOR_BASE} label={`All (${series.base.length})`} />
            )}
            {filters.outcomes.includes('just_right') && (
              <LegendSwatch color={COLOR_JUST_RIGHT} label={`Just right (${series.justRight.length})`} />
            )}
            {filters.outcomes.includes('no_major_wake') && (
              <LegendSwatch color={COLOR_NO_WAKE} label={`No major wake-ups (${series.noWake.length})`} />
            )}
            {showDimmed && (series.outcomeMismatch.length + series.intakeMismatch.length) > 0 && (
              <LegendSwatch
                color={COLOR_DIMMED}
                label={`Non-matches (${series.outcomeMismatch.length + series.intakeMismatch.length})`}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <h3>No nights match</h3>
          <p>
            Need nights with a room timeline in the selected range. Adjust the date range or
            relax a filter.
          </p>
        </div>
      )}
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex gap-4" style={{ alignItems: 'center' }}>
      <span
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: color,
        }}
      />
      <span className="text-secondary">{label}</span>
    </div>
  );
}
