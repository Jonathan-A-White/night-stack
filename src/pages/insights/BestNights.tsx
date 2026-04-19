import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { getEffectiveSleepData } from '../../utils';
import { SubNav } from './Dashboard';
import type { NightLog } from '../../types';

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesBeforeBed(mealTime: string, sleepTime: string): number | null {
  if (!mealTime || !sleepTime) return null;
  const mealMins = timeToMinutes(mealTime);
  let bedMins = timeToMinutes(sleepTime);
  if (bedMins < mealMins) bedMins += 24 * 60;
  return bedMins - mealMins;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function pct(count: number, total: number): number {
  if (total === 0) return 0;
  return (count / total) * 100;
}

interface GroupStats {
  glycinateFullDosePct: number;
  avgLastMealMins: number;
  avgRoomTemp: number;
  avgBeddingLayers: number;
  avgClothingLayers: number;
  eveningFlagFrequency: number;
}

function computeStats(logs: NightLog[]): GroupStats {
  const n = logs.length;

  // Glycinate full dose = baseStackUsed and no deviation that skipped/reduced glycinate
  const glycinateFullCount = logs.filter((log) => {
    if (!log.stack.baseStackUsed) return false;
    const glycinateDeviation = log.stack.deviations.find(
      (d) => d.deviation === 'skipped' || d.deviation === 'reduced'
    );
    return !glycinateDeviation;
  }).length;

  const mealMins = logs
    .map((log) => {
      if (!log.eveningIntake.lastMealTime || !log.sleepData?.sleepTime) return null;
      const sleepTime = getEffectiveSleepData(log)?.sleepTime ?? log.sleepData.sleepTime;
      return minutesBeforeBed(log.eveningIntake.lastMealTime, sleepTime);
    })
    .filter((v): v is number => v !== null);

  const roomTemps = logs
    .map((log) => log.environment.roomTempF)
    .filter((v): v is number => v !== null);

  const beddingLayers = logs.map((log) => log.bedding.length);
  const clothingLayers = logs.map((log) => log.clothing.length);

  const flaggedNights = logs.filter((log) =>
    log.eveningIntake.flags.some((f) => f.active)
  ).length;

  return {
    glycinateFullDosePct: pct(glycinateFullCount, n),
    avgLastMealMins: avg(mealMins),
    avgRoomTemp: avg(roomTemps),
    avgBeddingLayers: avg(beddingLayers),
    avgClothingLayers: avg(clothingLayers),
    eveningFlagFrequency: pct(flaggedNights, n),
  };
}

interface Comparison {
  label: string;
  bestValue: string;
  allValue: string;
  isBetter: boolean;
}

function buildComparisons(best: GroupStats, all: GroupStats): Comparison[] {
  return [
    {
      label: 'Glycinate full dose',
      bestValue: `${Math.round(best.glycinateFullDosePct)}%`,
      allValue: `${Math.round(all.glycinateFullDosePct)}%`,
      isBetter: best.glycinateFullDosePct > all.glycinateFullDosePct,
    },
    {
      label: 'Avg last meal before bed',
      bestValue: `${Math.round(best.avgLastMealMins)} min`,
      allValue: `${Math.round(all.avgLastMealMins)} min`,
      isBetter: best.avgLastMealMins > all.avgLastMealMins,
    },
    {
      label: 'Avg room temp',
      bestValue: `${best.avgRoomTemp.toFixed(1)}\u00b0F`,
      allValue: `${all.avgRoomTemp.toFixed(1)}\u00b0F`,
      isBetter: best.avgRoomTemp < all.avgRoomTemp,
    },
    {
      label: 'Avg bedding layers',
      bestValue: best.avgBeddingLayers.toFixed(1),
      allValue: all.avgBeddingLayers.toFixed(1),
      isBetter: best.avgBeddingLayers !== all.avgBeddingLayers,
    },
    {
      label: 'Avg clothing layers',
      bestValue: best.avgClothingLayers.toFixed(1),
      allValue: all.avgClothingLayers.toFixed(1),
      isBetter: best.avgClothingLayers !== all.avgClothingLayers,
    },
    {
      label: 'Evening flag frequency',
      bestValue: `${Math.round(best.eveningFlagFrequency)}%`,
      allValue: `${Math.round(all.eveningFlagFrequency)}%`,
      isBetter: best.eveningFlagFrequency < all.eveningFlagFrequency,
    },
  ];
}

export function BestNights() {
  const allLogs = useLiveQuery(
    () => db.nightLogs.orderBy('date').reverse().toArray(),
    []
  );

  const analysis = useMemo(() => {
    if (!allLogs) return null;

    const withScores = allLogs.filter((log) => log.sleepData?.sleepScore != null);
    if (withScores.length < 8) return { insufficient: true as const, count: withScores.length };

    // Sort by score descending to find top 25%
    const sorted = [...withScores].sort(
      (a, b) => b.sleepData!.sleepScore - a.sleepData!.sleepScore
    );
    const cutoff = Math.ceil(sorted.length * 0.25);
    const bestNights = sorted.slice(0, cutoff);
    const worstNights = sorted.slice(-cutoff);

    const bestStats = computeStats(bestNights);
    const allStats = computeStats(withScores);
    const worstStats = computeStats(worstNights);

    const bestComparisons = buildComparisons(bestStats, allStats);
    const worstComparisons = buildComparisons(worstStats, allStats);

    const bestScoreRange = {
      min: bestNights[bestNights.length - 1].sleepData!.sleepScore,
      max: bestNights[0].sleepData!.sleepScore,
    };

    const worstScoreRange = {
      min: worstNights[worstNights.length - 1].sleepData!.sleepScore,
      max: worstNights[0].sleepData!.sleepScore,
    };

    return {
      insufficient: false as const,
      totalNights: withScores.length,
      bestCount: bestNights.length,
      worstCount: worstNights.length,
      bestScoreRange,
      worstScoreRange,
      bestComparisons,
      worstComparisons,
      bestStats,
      worstStats,
    };
  }, [allLogs]);

  if (!allLogs) {
    return <div className="empty-state"><h3>Loading...</h3></div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Insights</h1>
        <p className="subtitle">What your best and worst nights have in common</p>
      </div>

      <SubNav active="best-nights" />

      {!analysis || analysis.insufficient ? (
        <div className="empty-state">
          <h3>Not enough data yet</h3>
          <p>
            You need at least 8 nights with sleep scores to see best/worst night analysis.
            {analysis && !analysis.insufficient ? '' : analysis ? ` You have ${analysis.count} so far.` : ''}
          </p>
        </div>
      ) : (
        <>
          <div className="card mb-8">
            <div className="text-secondary text-sm">
              Analyzing {analysis.totalNights} nights &mdash; top {analysis.bestCount} nights
              (scores {analysis.bestScoreRange.min}&ndash;{analysis.bestScoreRange.max}) vs
              bottom {analysis.worstCount} nights
              (scores {analysis.worstScoreRange.min}&ndash;{analysis.worstScoreRange.max})
            </div>
          </div>

          {/* Best Nights Section */}
          <div className="banner banner-success mb-8" style={{ fontWeight: 600, fontSize: 16 }}>
            Your Best Nights Had
          </div>
          <div className="card">
            {analysis.bestComparisons.map((c) => (
              <div key={c.label} className="summary-row">
                <div className="flex items-center gap-8">
                  <span style={{ color: 'var(--color-success)', fontSize: 16 }}>
                    {c.isBetter ? '\u2713' : '\u2014'}
                  </span>
                  <div>
                    <div className="fw-600 text-sm">{c.label}</div>
                    <div className="text-secondary text-sm">
                      Best: {c.bestValue} &middot; All: {c.allValue}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Worst Nights Section */}
          <div className="banner banner-danger mb-8" style={{ fontWeight: 600, fontSize: 16, marginTop: 16 }}>
            Your Worst Nights Had
          </div>
          <div className="card">
            {analysis.worstComparisons.map((c) => (
              <div key={c.label} className="summary-row">
                <div className="flex items-center gap-8">
                  <span style={{ color: 'var(--color-danger)', fontSize: 16 }}>
                    {c.isBetter ? '\u2717' : '\u2014'}
                  </span>
                  <div>
                    <div className="fw-600 text-sm">{c.label}</div>
                    <div className="text-secondary text-sm">
                      Worst: {c.bestValue} &middot; All: {c.allValue}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
