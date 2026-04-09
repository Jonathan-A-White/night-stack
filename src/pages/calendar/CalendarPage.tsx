import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { getTodayDate } from '../../utils';
import type { NightLog } from '../../types';

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/**
 * Format a Date object as "YYYY-MM-DD" using local time components (avoids
 * toISOString UTC shift that can move the date by a day in negative offsets).
 */
function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse a "YYYY-MM-DD" string into a Date object at local noon to avoid
 * timezone edge cases.
 */
function fromDateString(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00');
}

/**
 * Format a "YYYY-MM-DD" date string as e.g. "Thursday, April 9, 2026".
 */
function formatLongDate(dateStr: string): string {
  const d = fromDateString(dateStr);
  return `${WEEKDAY_FULL[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

interface MonthGridDay {
  dateStr: string;
  day: number;
  inCurrentMonth: boolean;
}

/**
 * Build a 6-row x 7-col grid of days surrounding the given month. Leading
 * days come from the previous month, trailing from the next, so the grid
 * is always 42 cells and aligned to Sunday.
 */
function buildMonthGrid(year: number, month: number): MonthGridDay[] {
  const firstOfMonth = new Date(year, month, 1);
  const startDayOfWeek = firstOfMonth.getDay(); // 0=Sun
  const gridStart = new Date(year, month, 1 - startDayOfWeek);

  const cells: MonthGridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push({
      dateStr: toDateString(d),
      day: d.getDate(),
      inCurrentMonth: d.getMonth() === month,
    });
  }
  return cells;
}

export function CalendarPage() {
  const navigate = useNavigate();
  const today = getTodayDate();

  // Anchor controls which month we're displaying
  const [anchor, setAnchor] = useState(() => {
    const d = fromDateString(today);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const [selectedDate, setSelectedDate] = useState<string>(today);

  // Earliest log in the database — used to prevent navigating to months
  // before any data exists. Falls back to the current month when there
  // are no logs yet.
  const earliestLog = useLiveQuery(
    () => db.nightLogs.orderBy('date').first(),
    []
  );

  const minMonth = useMemo(() => {
    const fallback = fromDateString(today);
    const base = earliestLog ? fromDateString(earliestLog.date) : fallback;
    return { year: base.getFullYear(), month: base.getMonth() };
  }, [earliestLog, today]);

  // Max month is the current month — no navigating into the future.
  const maxMonth = useMemo(() => {
    const d = fromDateString(today);
    return { year: d.getFullYear(), month: d.getMonth() };
  }, [today]);

  const atMinMonth =
    anchor.year < minMonth.year ||
    (anchor.year === minMonth.year && anchor.month <= minMonth.month);

  const atMaxMonth =
    anchor.year > maxMonth.year ||
    (anchor.year === maxMonth.year && anchor.month >= maxMonth.month);

  const prevDisabledReason = atMinMonth
    ? earliestLog
      ? `No log data before ${MONTH_NAMES[minMonth.month]} ${minMonth.year}`
      : "No earlier log data yet"
    : null;
  const nextDisabledReason = atMaxMonth
    ? "Can't view future months"
    : null;

  const gridCells = useMemo(
    () => buildMonthGrid(anchor.year, anchor.month),
    [anchor]
  );

  // Date range for the entire visible grid (not just the month)
  const rangeStart = gridCells[0].dateStr;
  const rangeEnd = gridCells[gridCells.length - 1].dateStr;

  // Fetch all logs whose date falls within the visible grid range
  const logs = useLiveQuery(
    () =>
      db.nightLogs
        .where('date')
        .between(rangeStart, rangeEnd, true, true)
        .toArray(),
    [rangeStart, rangeEnd]
  );

  // Index logs by date for fast lookup
  const logsByDate = useMemo(() => {
    const map = new Map<string, NightLog>();
    for (const log of logs ?? []) {
      map.set(log.date, log);
    }
    return map;
  }, [logs]);

  function goPrevMonth() {
    if (atMinMonth) return;
    setAnchor((a) => {
      const m = a.month - 1;
      if (m < 0) return { year: a.year - 1, month: 11 };
      return { year: a.year, month: m };
    });
  }

  function goNextMonth() {
    if (atMaxMonth) return;
    setAnchor((a) => {
      const m = a.month + 1;
      if (m > 11) return { year: a.year + 1, month: 0 };
      return { year: a.year, month: m };
    });
  }

  function goToday() {
    const d = fromDateString(today);
    setAnchor({ year: d.getFullYear(), month: d.getMonth() });
    setSelectedDate(today);
  }

  const selectedLog = selectedDate ? logsByDate.get(selectedDate) : undefined;
  const hasEvening = selectedLog !== undefined;
  const hasMorning = selectedLog !== undefined && selectedLog.sleepData !== null;

  return (
    <div>
      <div className="page-header">
        <h1>Calendar</h1>
        <p className="subtitle">View and edit past log entries</p>
      </div>

      <div className="card">
        <div className="calendar-header">
          <button
            className="btn btn-secondary btn-sm"
            onClick={goPrevMonth}
            aria-label={
              prevDisabledReason
                ? `Previous month (disabled: ${prevDisabledReason})`
                : 'Previous month'
            }
            title={prevDisabledReason ?? 'Previous month'}
            disabled={atMinMonth}
          >
            {'\u25C0'}
          </button>
          <div className="calendar-title">
            {MONTH_NAMES[anchor.month]} {anchor.year}
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={goNextMonth}
            aria-label={
              nextDisabledReason
                ? `Next month (disabled: ${nextDisabledReason})`
                : 'Next month'
            }
            title={nextDisabledReason ?? 'Next month'}
            disabled={atMaxMonth}
          >
            {'\u25B6'}
          </button>
        </div>

        {(prevDisabledReason || nextDisabledReason) && (
          <div className="calendar-nav-hint" role="status">
            {prevDisabledReason && nextDisabledReason
              ? `${prevDisabledReason} • ${nextDisabledReason}`
              : prevDisabledReason ?? nextDisabledReason}
          </div>
        )}

        <div className="calendar-today-row">
          <button className="btn btn-secondary btn-sm" onClick={goToday}>
            Today
          </button>
        </div>

        <div className="calendar-weekdays">
          {WEEKDAY_LETTERS.map((letter, i) => (
            <div key={i} className="calendar-weekday">
              {letter}
            </div>
          ))}
        </div>

        <div className="calendar-grid">
          {gridCells.map((cell) => {
            const log = logsByDate.get(cell.dateStr);
            const hasLog = log !== undefined;
            const hasFull = hasLog && log.sleepData !== null;
            const hasEveningOnly = hasLog && log.sleepData === null;
            const isToday = cell.dateStr === today;
            const isSelected = cell.dateStr === selectedDate;

            const classes = ['calendar-cell'];
            if (!cell.inCurrentMonth) classes.push('other-month');
            if (isToday) classes.push('today');
            if (isSelected) classes.push('selected');
            if (hasFull) classes.push('has-full');
            else if (hasEveningOnly) classes.push('has-evening');

            return (
              <button
                key={cell.dateStr}
                className={classes.join(' ')}
                onClick={() => setSelectedDate(cell.dateStr)}
                aria-label={cell.dateStr}
                aria-pressed={isSelected}
              >
                <span className="calendar-day-number">{cell.day}</span>
                {(hasFull || hasEveningOnly) && (
                  <span
                    className={`calendar-dot${hasFull ? ' dot-full' : ' dot-evening'}`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selectedDate && (
        <div className="card">
          <div className="card-title">{formatLongDate(selectedDate)}</div>

          <div className="calendar-entry-row">
            <div className="calendar-entry-info">
              <div className="fw-600">Evening log</div>
              <div className="text-secondary text-sm">
                {hasEvening ? 'Logged' : 'Not logged'}
              </div>
            </div>
            <div className="calendar-entry-actions">
              {hasEvening ? (
                <>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      navigate(`/tonight/review/${selectedDate}`)
                    }
                  >
                    View
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() =>
                      navigate(`/tonight/log?date=${selectedDate}`)
                    }
                  >
                    Edit
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() =>
                    navigate(`/tonight/log?date=${selectedDate}`)
                  }
                >
                  Log evening
                </button>
              )}
            </div>
          </div>

          <div className="calendar-entry-row">
            <div className="calendar-entry-info">
              <div className="fw-600">Morning log</div>
              <div className="text-secondary text-sm">
                {hasMorning
                  ? 'Logged'
                  : hasEvening
                  ? 'Not yet completed'
                  : 'Needs evening log first'}
              </div>
            </div>
            <div className="calendar-entry-actions">
              {hasMorning ? (
                <>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      navigate(`/morning/review/${selectedDate}`)
                    }
                  >
                    View
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => navigate('/morning')}
                  >
                    Edit
                  </button>
                </>
              ) : hasEvening ? (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => navigate('/morning')}
                >
                  Log morning
                </button>
              ) : (
                <button className="btn btn-secondary btn-sm" disabled>
                  Unavailable
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Legend</div>
        <div className="calendar-legend">
          <div className="calendar-legend-item">
            <span className="calendar-dot dot-full" />
            <span className="text-secondary text-sm">Full log (evening + morning)</span>
          </div>
          <div className="calendar-legend-item">
            <span className="calendar-dot dot-evening" />
            <span className="text-secondary text-sm">Evening only</span>
          </div>
        </div>
      </div>
    </div>
  );
}
