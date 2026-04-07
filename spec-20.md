# NightStack — App Specification

> **Purpose:** NightStack is an offline-first PWA for tracking sleep inputs (supplements, food, environment, clothing/bedding) and sleep outputs (Samsung Health data, wake-up events, subjective quality), with the goal of predicting optimal nightly routines and debugging poor sleep nights.
>
> **Audience:** An agent team implementing NightStack from the shared PWA scaffold (`scaffold.md`).
>
> **User:** Single user (Jonathan), mobile-first, Android phone.

---

## 1. Domain Overview

NightStack treats sleep optimization as an experiment. Each night is a data point with **inputs** (what the user controlled) and **outputs** (what happened). The app's core value is:

1. **Tonight's Plan** — actionable recommendations derived from historical patterns and tomorrow's conditions
2. **Morning Debrief** — fast logging of what happened overnight
3. **Pattern Discovery** — correlation dashboard and insight summaries to surface what works and what doesn't

The data flow each day:

```
Evening:  Confirm alarm → View tonight's plan → Log stack, food, environment, clothing/bedding
Morning:  Import sleep data (JSON) → Import room data (CSV) → Log wake-up events → Explain bedtime
Analysis: Dashboard updates automatically → Rules engine refines recommendations
```

---

## 2. Entities & Data Model

### 2.1 Core Entities

All entities use `string` IDs (`crypto.randomUUID()`) and `number` timestamps (epoch ms).

#### NightLog

The central entity. One per calendar night (keyed by sleep date, e.g., `2026-04-06` = the night of April 6th going into April 7th morning).

```ts
interface NightLog {
  id: string;
  date: string; // ISO date "YYYY-MM-DD" — the evening date
  createdAt: number;
  updatedAt: number;

  // Alarm & Schedule
  alarm: AlarmInfo;

  // Evening Inputs
  stack: StackEntry;
  eveningIntake: EveningIntake;
  environment: EnvironmentEntry;
  clothing: string[]; // IDs of ClothingItem
  bedding: string[]; // IDs of BeddingItem

  // Morning Outputs
  sleepData: SleepData | null; // From Samsung Health JSON import
  roomTimeline: RoomReading[] | null; // From Govee CSV import
  wakeUpEvents: WakeUpEvent[];
  bedtimeExplanation: BedtimeExplanation | null;

  // Notes
  eveningNotes: string;
  morningNotes: string;
}
```

#### AlarmInfo

```ts
interface AlarmInfo {
  expectedAlarmTime: string; // "HH:MM" — from schedule defaults
  actualAlarmTime: string; // "HH:MM" — confirmed or overridden by user
  isOverridden: boolean;
  targetBedtime: string; // "HH:MM" — calculated (5 sleep cycles back from alarm)
  eatingCutoff: string; // "HH:MM" — calculated (2.5 hours before target bedtime)
  supplementTime: string; // "HH:MM" — calculated (30-60 min before target bedtime)
}
```

#### StackEntry

Tracks deviations from the user's base supplement stack.

```ts
interface StackEntry {
  baseStackUsed: boolean; // true = took everything as defined
  deviations: StackDeviation[];
}

interface StackDeviation {
  id: string;
  supplementId: string; // Reference to SupplementDef
  deviation: "skipped" | "reduced" | "increased" | "substituted" | "added";
  notes: string; // e.g., "took 200mg instead of 400mg"
}
```

#### EveningIntake

```ts
interface EveningIntake {
  lastMealTime: string; // "HH:MM"
  foodDescription: string; // Free text
  flags: EveningFlag[];
  alcohol: AlcoholEntry | null;
  liquidIntake: string; // Free text (e.g., "16oz water", "glass of coconut water")
}

interface EveningFlag {
  type: "overate" | "high_salt" | "nitrates" | "questionable_food" | "late_meal" | "custom";
  label: string; // Display label (customizable for "custom" type)
  active: boolean;
}

interface AlcoholEntry {
  type: string; // e.g., "red wine", "beer"
  amount: string; // e.g., "4oz"
  time: string; // "HH:MM"
}
```

#### EnvironmentEntry

```ts
interface EnvironmentEntry {
  roomTempF: number | null; // Manual bedtime reading from Govee
  roomHumidity: number | null; // Manual bedtime reading from Govee
  externalWeather: ExternalWeather | null; // Auto-fetched from Open-Meteo
}

interface ExternalWeather {
  overnightTemps: HourlyReading[]; // Hourly temps from ~9 PM to ~7 AM
  overnightHumidity: HourlyReading[];
  fetchedAt: number;
}

interface HourlyReading {
  hour: string; // ISO datetime
  value: number;
}
```

#### SleepData (from Samsung Health JSON import)

```ts
interface SleepData {
  sleepTime: string; // "HH:MM" — time got in bed
  wakeTime: string; // "HH:MM"
  totalSleepDuration: number; // minutes
  actualSleepDuration: number; // minutes
  sleepScore: number;
  sleepScoreDelta: number; // e.g., +5 or -17
  deepSleep: number; // minutes
  remSleep: number; // minutes
  lightSleep: number; // minutes
  awakeDuration: number; // minutes
  avgHeartRate: number; // bpm
  avgRespiratoryRate: number; // breaths/min
  bloodOxygenAvg: number; // percent
  skinTempRange: string; // e.g., "-7.5 to -1.3°F"
  sleepLatencyRating: "Excellent" | "Good" | "Fair" | "Attention";
  restfulnessRating: "Excellent" | "Good" | "Fair" | "Attention";
  deepSleepRating: "Excellent" | "Good" | "Fair" | "Attention";
  remSleepRating: "Excellent" | "Good" | "Fair" | "Attention";
  importedAt: number;
}
```

#### RoomReading (from Govee CSV import)

```ts
interface RoomReading {
  timestamp: string; // ISO datetime
  tempF: number;
  humidity: number;
}
```

#### WakeUpEvent

```ts
interface WakeUpEvent {
  id: string;
  startTime: string; // "HH:MM" — when the wake-up began
  endTime: string; // "HH:MM" — when fell back asleep (empty if didn't)
  cause: string; // ID of WakeUpCause
  fellBackAsleep: "yes" | "no" | "eventually";
  minutesToFallBackAsleep: number | null;
  notes: string;
}
```

#### BedtimeExplanation

```ts
interface BedtimeExplanation {
  actualBedtime: string; // "HH:MM" — derived from SleepData.sleepTime
  targetBedtime: string; // "HH:MM" — from AlarmInfo
  wasLate: boolean;
  reason: string; // ID of BedtimeReason
  notes: string;
}
```

### 2.2 Configuration Entities

These are user-defined and persist across nights.

#### SupplementDef

```ts
interface SupplementDef {
  id: string;
  name: string; // e.g., "Magnesium Glycinate"
  defaultDose: string; // e.g., "400mg"
  timing: "morning" | "lunch" | "dinner" | "bedtime";
  frequency: "daily" | "every_other_day" | "weekdays" | "custom";
  notes: string;
  isActive: boolean;
  sortOrder: number;
}
```

#### ClothingItem

```ts
interface ClothingItem {
  id: string;
  name: string; // e.g., "Wool socks", "Ice Breaker top"
  sortOrder: number;
  isActive: boolean;
}
```

#### BeddingItem

```ts
interface BeddingItem {
  id: string;
  name: string; // e.g., "Wool comforter", "Cotton sheets"
  sortOrder: number;
  isActive: boolean; // Can soft-delete seasonal items
}
```

#### WakeUpCause

```ts
interface WakeUpCause {
  id: string;
  label: string; // e.g., "Heart racing", "Sweating", "Bathroom", "Too hot"
  sortOrder: number;
  isActive: boolean;
}
```

#### BedtimeReason

```ts
interface BedtimeReason {
  id: string;
  label: string; // e.g., "Work", "Screen time", "Couldn't wind down", "Family", "Lost track of time"
  sortOrder: number;
  isActive: boolean;
}
```

#### AlarmSchedule

```ts
interface AlarmSchedule {
  id: string;
  dayOfWeek: number; // 0=Sunday, 1=Monday, ...
  alarmTime: string; // "HH:MM" or null for no-alarm days
  hasAlarm: boolean;
  naturalWakeTime: string | null; // For no-alarm days, approximate wake time
}
```

**Default schedule:**

| Day | Alarm | Time |
|---|---|---|
| Sunday | No | ~7:15 AM |
| Monday | Yes | 4:43 AM |
| Tuesday | Yes | 4:43 AM |
| Wednesday | Yes | 6:15 AM |
| Thursday | Yes | 4:43 AM |
| Friday | Yes | 6:15 AM |
| Saturday | No | ~7:15 AM |

#### SleepRule

```ts
interface SleepRule {
  id: string;
  name: string;
  condition: string; // Human-readable condition
  recommendation: string; // What to do
  priority: "high" | "medium" | "low";
  isActive: boolean;
  source: "seeded" | "user"; // Whether it came from initial seed or user-created
  createdAt: number;
}
```

### 2.3 Dexie Schema

```ts
class NightStackDB extends Dexie {
  nightLogs!: Table<NightLog>;
  supplementDefs!: Table<SupplementDef>;
  clothingItems!: Table<ClothingItem>;
  beddingItems!: Table<BeddingItem>;
  wakeUpCauses!: Table<WakeUpCause>;
  bedtimeReasons!: Table<BedtimeReason>;
  alarmSchedules!: Table<AlarmSchedule>;
  sleepRules!: Table<SleepRule>;

  constructor() {
    super("nightstack");
    this.version(1).stores({
      nightLogs: "id, date",
      supplementDefs: "id, sortOrder",
      clothingItems: "id, sortOrder",
      beddingItems: "id, sortOrder",
      wakeUpCauses: "id, sortOrder",
      bedtimeReasons: "id, sortOrder",
      alarmSchedules: "id, dayOfWeek",
      sleepRules: "id, priority",
    });
  }
}
```

---

## 3. Seed Data

### 3.1 Base Supplement Stack

| Name | Default Dose | Timing | Frequency |
|---|---|---|---|
| Magnesium Glycinate | 400mg | Bedtime | Daily |
| Natural Calm (Mg Citrate + L-Theanine) | 1 tsp (200mg Mg + 200mg L-Theanine) | Bedtime | Daily |
| Cream of Tartar | ¼ tsp | Bedtime (in Calm drink) | Daily |
| Salt (pinch) | pinch | Bedtime (in Calm drink) | Daily |
| Iron Bisglycinate (Solgar) | 50mg (2 capsules) | Morning with Vitamin C | Every other day |
| Focus Factor | 4 tablets | Lunch | Daily |
| Elderberry (Vitamin C + D3 + Zinc) | 2 gummies | Lunch | Daily (seasonal — cold season only) |
| Copper Bisglycinate (Bluebonnet) | 3mg | Dinner | Every other day |
| Zinc Picolinate (Swanson) | 22mg | Dinner | Daily (pending reorder) |
| LoSalt | 1 tsp | Throughout day | Daily |
| Sea Salt | ½ tsp | Throughout day | Daily |
| LoSalt (morning) | ¼ tsp | Morning | Daily |
| Sea Salt (morning) | ¼ tsp | Morning | Daily |

### 3.2 Clothing Items

| Name |
|---|
| Underwear only |
| Wool socks |
| Ice Breaker top |
| Ice Breaker bottom |
| Wool hat |
| Light PJs |

### 3.3 Bedding Items (listed top to bottom as on bed)

| Name | Sort Order |
|---|---|
| Wool comforter | 1 |
| Wool blanket #1 | 2 |
| Wool blanket #2 | 3 |
| Wool blanket #3 | 4 |
| Cotton blanket | 5 |
| Cotton sheets | 6 |

### 3.4 Wake-Up Causes

| Label |
|---|
| Heart racing / palpitations |
| Sweating / too hot |
| Too cold |
| Bathroom |
| Noise |
| Pain / discomfort |
| Anxiety / racing thoughts |
| Unknown |

### 3.5 Bedtime Reasons (for going to bed late)

| Label |
|---|
| Work / project |
| Screen time |
| Couldn't wind down |
| Family |
| Lost track of time |
| Social / phone |
| Felt wired / not tired |
| Other |

### 3.6 Seeded Sleep Rules

These rules were derived from a week of empirical sleep tracking and troubleshooting.

| # | Name | Condition | Recommendation | Priority |
|---|---|---|---|---|
| 1 | Full glycinate dose | Always | Keep Magnesium Glycinate at 400mg — do not reduce when adding Calm. Citrate does not substitute for glycinate for sleep maintenance. | High |
| 2 | Eating cutoff | Food logged after eating cutoff time | Stop eating 2-3 hours before target bedtime. Thermic effect of food (especially protein/fat like peanuts) raises core temperature and causes overnight wake-ups. | High |
| 3 | Light covers rule | Room temp > 68°F OR external temp > 50°F | Use light covers. Skip wool comforter. Overdressing/over-covering causes sweating and cortisol-driven wake-ups around 3-4 AM. | High |
| 4 | No heavy layers | Feeling cold at bedtime | Use a blanket you can kick off rather than wearing heavy layers. You can't shed clothing while asleep. Underwear + kickable blanket > layers. | High |
| 5 | Peanut moderation | Peanuts/PB flagged in evening food | Limit peanuts to one serving per day. Heavy peanut intake = more phytic acid (blocks mineral absorption) + higher thermic effect. Time peanuts away from supplements. | Medium |
| 6 | Bedtime target | Every night | Calculate bedtime from alarm: 5 sleep cycles (7.5 hrs) + time to fall asleep. Consistently going to bed late is the #1 drag on total sleep. | High |
| 7 | Alcohol timing | Alcohol logged in evening intake | Finish alcohol with dinner (2-3 hrs before bed). Alcohol is a vasodilator — adds to overnight warming. At 4oz dry red wine, effect is small but compounds with other heat factors. | Low |
| 8 | Glycine for wake recovery | Recurrent 3 AM wake-up events | Consider adding 3g glycine powder at bedtime or keep on nightstand for middle-of-night use. Glycine lowers core body temperature and promotes sleep onset. | Medium |
| 9 | Magnesium total ceiling | Always | Keep total daily magnesium under 600-800mg. Currently: ~100mg (Focus Factor) + 200mg (Calm citrate) + 400mg (glycinate) = 700mg. Watch for loose stools. | Medium |
| 10 | Supplement spacing | Iron supplement days | On iron mornings, keep 2+ hours before lunch (Focus Factor has zinc/magnesium that compete with iron absorption). Take zinc picolinate at dinner, not with iron. | Medium |

---

## 4. Pages & Navigation

### 4.1 Navigation Pattern

**Bottom tabs** with 4 sections:

| Tab | Icon | Label | Description |
|---|---|---|---|
| 1 | Moon/stars | Tonight | Tonight's plan + evening logging |
| 2 | Sun/sunrise | Morning | Morning debrief + data import |
| 3 | Chart/graph | Insights | Correlation dashboard + summaries |
| 4 | Gear | Settings | Configuration for all entities |

### 4.2 Page Map

```
Tonight (Tab 1)
├── TonightPlan          — Hero screen: recommendations for tonight
├── EveningLog           — Step-through form for evening inputs
│   ├── Step 1: Alarm confirmation
│   ├── Step 2: Supplement stack (toggle deviations)
│   ├── Step 3: Evening food & drink
│   ├── Step 4: Room temp & humidity (manual)
│   ├── Step 5: Clothing selection (toggle items)
│   ├── Step 6: Bedding selection (toggle items)
│   └── Step 7: Evening notes + confirm
└── EveningReview        — Summary of what was logged

Morning (Tab 2)
├── MorningLog           — Step-through form for morning data
│   ├── Step 1: Import Samsung Health JSON
│   ├── Step 2: Import Govee CSV
│   ├── Step 3: Wake-up events (add/edit)
│   ├── Step 4: Bedtime explanation (if late)
│   └── Step 5: Morning notes + confirm
└── MorningReview        — Summary of the complete night

Insights (Tab 3)
├── Dashboard            — Overview: recent scores, trends, streak
├── Correlations         — Scatter plots: pick any input vs any output
└── BestNights           — "Your best nights had these in common"

Settings (Tab 4)
├── AlarmSchedule        — Default weekly alarm times
├── SupplementStack      — Manage base supplement definitions
├── ClothingItems        — Manage wardrobe items
├── BeddingItems         — Manage bedding layers
├── WakeUpCauses         — Manage wake-up cause options
├── BedtimeReasons       — Manage late bedtime reason options
├── SleepRules           — View/add/edit/deactivate rules
├── Location             — Set lat/lon for weather fetch (default: Bethel, CT)
├── DataManagement       — Export/import full JSON backup
└── About                — App version, dark mode toggle
```

---

## 5. Page Specifications

### 5.1 Tonight's Plan (Hero Screen)

This is the most important screen. It appears when the user opens the app in the evening.

**Layout:**

```
┌──────────────────────────┐
│ Tonight's Plan           │
│ Tuesday → 4:43 AM alarm  │
├──────────────────────────┤
│ ⏰ Target Bedtime: 9:00 PM│
│ 🍽 Stop Eating: 6:30 PM  │
│ 💊 Supplements: 8:15 PM  │
├──────────────────────────┤
│ 🌡 Forecast: 45°F overnight│
│ → Normal covers OK       │
├──────────────────────────┤
│ Recommendations:         │
│                          │
│ ⚠️ HIGH: Keep glycinate  │
│   at 400mg tonight       │
│                          │
│ ⚠️ HIGH: Eating cutoff   │
│   is 6:30 PM             │
│                          │
│ 💡 MED: Room is 72°F —   │
│   consider dropping wool │
│   comforter              │
├──────────────────────────┤
│ [ Start Evening Log ]    │
└──────────────────────────┘
```

**Behavior:**

- Auto-fetches tomorrow's weather from Open-Meteo on page load (Bethel, CT: lat 41.37, lon -73.41)
- Alarm time derived from `AlarmSchedule` for tomorrow's day of week
- Asks "Tomorrow is [day] — [time] alarm. Still correct?" with override option
- Target bedtime = alarm time minus 7h 30m (5 sleep cycles)
- Eating cutoff = target bedtime minus 2h 30m
- Supplement time = target bedtime minus 45m
- Recommendations generated by evaluating all active `SleepRule` entries against current conditions and recent NightLog history
- Rules sorted by priority (high → medium → low)
- "Start Evening Log" button opens the EveningLog step-through form

### 5.2 Evening Log

A multi-step form. Progress indicator at top. Each step is a full-screen card. Swipe or "Next" button to advance. "Back" to return. "Save" on final step persists the NightLog.

**Step 1: Alarm Confirmation**

- Shows tomorrow's default alarm from schedule
- "Correct" button or tap to override time
- Display calculated bedtime, eating cutoff, supplement time
- If current time is past eating cutoff, show a warning

**Step 2: Supplement Stack**

- Shows the full base stack with checkboxes, all pre-checked
- Toggle "Took as planned" switch at top (default: on)
- If toggled off, show the supplement list — tap any to mark deviation
- Deviation options: skipped, reduced dose, increased dose, substituted, added something new
- Free-text notes per deviation
- For "every_other_day" supplements, app calculates whether today is an "on" day based on history and pre-checks accordingly

**Step 3: Evening Food & Drink**

- Time picker: "When did you last eat?" (pre-filled with current time)
- Text field: "What did you eat after dinner?"
- Toggle flags: Overate, High salt, Nitrates, Questionable food, Late meal
- Alcohol section: toggle on/off → type, amount, time
- Liquid intake: free text field
- If last meal time is after eating cutoff, show amber warning

**Step 4: Room Environment**

- Room temperature (°F): number input
- Room humidity (%): number input
- Both optional — can skip if Govee not available
- Show current external temperature (auto-fetched) for reference

**Step 5: Clothing**

- Grid of toggle buttons, one per ClothingItem
- Tap to select/deselect
- Multi-select — combinations are the norm
- Sorted by sortOrder

**Step 6: Bedding**

- Ordered list of toggle buttons, one per BeddingItem
- Displayed in top-to-bottom bed order (wool comforter at top, sheets at bottom)
- Tap to select/deselect
- Multi-select

**Step 7: Confirm & Notes**

- Free text "Evening notes" field
- Summary of everything logged
- "Save" button persists NightLog

### 5.3 Morning Log

Also a multi-step form. Opens from the Morning tab.

**Step 1: Import Samsung Health Data**

- "Import Sleep JSON" button → file picker accepting `.json`
- On import, validate against `SleepData` schema
- Show parsed data in a summary card for confirmation
- "Looks right" to accept, "Try again" to re-import
- Manual entry fallback: all SleepData fields editable if no JSON available

**Step 2: Import Govee Room Data**

- "Import Govee CSV" button → file picker accepting `.csv`
- Parse CSV into `RoomReading[]` — extract timestamp, temp, humidity
- Show a mini line chart of overnight room temp for confirmation
- "Skip" option if Govee data not available

**Step 3: Wake-Up Events**

- "Did you wake up during the night?" toggle
- If JSON import included `wakeUpEvents`, auto-populate this step (toggle on, events pre-filled with cause labels matched to WakeUpCause IDs)
- If yes: "Add wake-up event" button
- Per event:
  - Start time — "Woke up at" (time picker, side-by-side with end time)
  - End time — "Back to sleep at" (time picker, may be empty if didn't fall back asleep)
  - Cause (select from WakeUpCause list)
  - Fell back asleep? (yes / no / eventually)
  - If yes/eventually: minutes to fall back asleep (number)
  - Notes (free text)
- Can add multiple events
- Editable and deletable

**Step 4: Bedtime Explanation**

- Only shown if `SleepData.sleepTime` is later than `AlarmInfo.targetBedtime`
- "You went to bed at 11:23 PM. Target was 9:00 PM."
- "What happened?" — select from BedtimeReason list
- Notes field
- If bedtime was on target or early, skip this step automatically

**Step 5: Confirm & Notes**

- Free text "Morning notes" field
- Full night summary card showing inputs + outputs side by side
- "Save" button updates the NightLog

### 5.4 Dashboard (Insights Tab — Default View)

**Layout:**

- **Sleep Score Trend** — Line chart of sleep scores for last 14 nights (default), adjustable range
- **Key Metrics Cards** — Rolling 7-day averages:
  - Avg sleep score
  - Avg total sleep
  - Avg deep sleep
  - Avg heart rate
  - Nights with wake-up events (count)
- **Recent Nights List** — Scrollable list of last 7 NightLogs showing date, score, key flags (late bedtime, wake-up events, deviations)
- Tap any night to open full NightLog detail view

### 5.5 Correlations (Insights Tab — Sub-page)

**Scatter Plot Builder:**

- **X-axis picker** — select any input variable:
  - Room temp at bedtime
  - External overnight low temp
  - Room humidity
  - Last meal time (as minutes before bedtime)
  - Number of bedding layers
  - Number of clothing layers
  - Alcohol (yes/no or amount)
  - Total magnesium dose
  - Any flag (overate, high salt, etc.)
- **Y-axis picker** — select any output variable:
  - Sleep score
  - Deep sleep minutes
  - REM minutes
  - Awake minutes
  - Avg heart rate
  - Number of wake-up events
  - Minutes to fall back asleep (first event)
  - Restfulness rating (mapped to numeric: Excellent=4, Good=3, Fair=2, Attention=1)

- Render scatter plot with dots per night
- Show trend line (linear regression)
- Show correlation coefficient (r value)
- Color dots by a third variable if desired (e.g., color by "wore layers yes/no")

### 5.6 Best Nights Summary (Insights Tab — Sub-page)

Analyzes NightLogs to find patterns in the top-performing nights.

**Logic:**

- Define "best nights" as top 25% by sleep score (minimum 8 nights of data required)
- For each input variable, compare the average/mode in "best nights" vs all nights
- Surface statistically meaningful differences

**Display:**

```
Your Best Nights Had:
✅ Glycinate at full 400mg dose (100% of best nights)
✅ Last meal before 7:00 PM (avg 6:42 PM vs 7:58 PM overall)
✅ Room temp 66-70°F (avg 68°F vs 71°F overall)
✅ 3 or fewer bedding layers
✅ No evening food flags

Your Worst Nights Had:
❌ Late meals (after 8:30 PM)
❌ Glycinate reduced to 200mg
❌ 5+ bedding layers or heavy clothing
❌ Overeating flag
```

---

## 6. Notifications

Use the Web Notifications API (with permission prompt on first use).

### 6.1 Notification Schedule

All times calculated backward from tomorrow's confirmed alarm time.

| Notification | When | Message |
|---|---|---|
| Eating cutoff | Target bedtime minus 2h 30m | "Eating cutoff — stop eating to sleep well tonight" |
| Supplement reminder | Target bedtime minus 45m | "Time for your bedtime stack" |
| Bedtime warning | Target bedtime minus 15m | "15 minutes to bedtime — start winding down" |
| Bedtime | Target bedtime | "Bedtime! Target sleep time reached" |
| Morning log reminder | Alarm time + 2 hours | "Don't forget to log last night's sleep" |

### 6.2 Implementation Notes

- Notifications scheduled after evening log is saved (alarm confirmed)
- Use `setTimeout` or service worker `showNotification` for PWA background delivery
- Reschedule if alarm time is overridden
- Respect system notification permissions — degrade gracefully if denied
- Store notification preference in settings (on/off per notification type)

---

## 7. External Data Integration

### 7.1 Open-Meteo Weather API

**Endpoint:** `https://api.open-meteo.com/v1/forecast`

**Parameters:**

```
latitude=41.37
longitude=-73.41
hourly=temperature_2m,relative_humidity_2m
temperature_unit=fahrenheit
timezone=America/New_York
forecast_days=2
```

**Usage:**

- Fetch on Tonight's Plan page load
- Extract hourly temperature and humidity for overnight window (9 PM tonight → 7 AM tomorrow)
- Cache response in the NightLog's `environment.externalWeather`
- Used by rules engine for cover/clothing recommendations
- No API key required

### 7.2 Samsung Health Data (JSON Import)

The user creates the JSON externally by sending a Samsung Health screenshot to a Claude project with a system prompt defining the `SleepData` schema.

**Expected JSON format:**

```json
{
  "sleepTime": "22:31",
  "wakeTime": "04:43",
  "totalSleepDuration": 372,
  "actualSleepDuration": 351,
  "sleepScore": 82,
  "sleepScoreDelta": 5,
  "deepSleep": 64,
  "remSleep": 108,
  "lightSleep": 179,
  "awakeDuration": 21,
  "avgHeartRate": 48,
  "avgRespiratoryRate": 15.1,
  "bloodOxygenAvg": 93,
  "skinTempRange": "-2.5 to +2.1°F",
  "sleepLatencyRating": "Excellent",
  "restfulnessRating": "Excellent",
  "deepSleepRating": "Excellent",
  "remSleepRating": "Excellent",
  "wakeUpEvents": [
    {
      "startTime": "00:40",
      "endTime": "00:55",
      "cause": "Too cold",
      "notes": "Added blanket"
    }
  ]
}
```

**`wakeUpEvents` array (optional):**

- Each entry requires at minimum a `startTime` ("HH:MM" 24hr). Entries without `startTime` are skipped.
- `endTime` — when the user fell back asleep (empty string or omitted if they didn't)
- `cause` — label text matching a WakeUpCause entry (e.g., "Too cold", "Bathroom", "Sweating / too hot", "Heart racing / palpitations", "Noise", "Pain / discomfort", "Anxiety / racing thoughts", "Unknown"). Matched case-insensitively to WakeUpCause labels on import.
- `notes` — optional free text
- When present, auto-populates Step 3 of the morning log wizard (toggles "Did you wake up?" on and pre-fills events)

**Validation on import:**

- All required fields present
- Numeric fields within reasonable ranges
- Rating fields match enum values
- Show parsed summary for user confirmation before saving

### 7.3 Govee Room Data (CSV Import)

The user exports CSV from the Govee Home app.

**Expected CSV format** (Govee's standard export):

```csv
Timestamp,Temperature(°F),Humidity(%)
2026-04-06 22:00,68.2,45
2026-04-06 23:00,67.8,46
...
```

**Processing:**

- Parse CSV, filter to overnight window matching the NightLog date
- Store as `RoomReading[]` on the NightLog
- Display as a mini line chart on import confirmation and in morning review

---

## 8. Rules Engine

### 8.1 Architecture

The rules engine is a simple evaluator, not a machine learning system. Rules are stored as `SleepRule` entities with human-readable conditions and recommendations.

### 8.2 Evaluation

When generating Tonight's Plan:

1. Load all active `SleepRule` entries
2. For each rule, evaluate its condition against:
   - Current conditions (weather, time, day of week)
   - Recent NightLog history (last 7 days)
   - Current NightLog state (if evening log started)
   - Configuration data (alarm schedule, base stack)
3. If condition is met, include the recommendation in Tonight's Plan
4. Sort by priority

### 8.3 Condition Evaluation

For v1, conditions are evaluated by matching keywords/types. Rules have a `condition` field that is human-readable text interpreted by simple pattern matching:

- **"Always"** — always show this recommendation
- **"Room temp > X"** — compare against environment data
- **"Food logged after eating cutoff time"** — compare evening intake time
- **"Alcohol logged"** — check evening intake
- **"Recurrent 3 AM wake-up events"** — check last N nights for wake-up events between 2-4 AM

The rules engine should be designed to be extensible — v1 uses simple keyword matching, but the architecture should allow for more sophisticated condition parsing in the future.

### 8.4 Rule Management UI

- List all rules (active and inactive)
- Toggle active/inactive
- Edit rule text (condition + recommendation)
- Add new rules
- Delete user-created rules (seeded rules can only be deactivated, not deleted)
- Seeded rules are labeled as "Seeded" to distinguish from user-created

---

## 9. Calculations

### 9.1 Schedule Calculations

```
targetBedtime = alarmTime - (7 * 60 + 30) minutes  // 5 sleep cycles
eatingCutoff = targetBedtime - (2 * 60 + 30) minutes  // 2.5 hours before bed
supplementTime = targetBedtime - 45 minutes
```

### 9.2 "Every Other Day" Supplement Logic

For supplements with `frequency: "every_other_day"`:

- Look at the last NightLog that included this supplement
- If it was taken yesterday (or no history exists), mark as "off day" today
- If it was not taken yesterday, mark as "on day" today
- Pre-check the supplement accordingly in the stack UI

### 9.3 Best Nights Analysis

- Requires minimum 8 completed NightLogs with sleep scores
- "Best nights" = top 25% by sleep score
- For categorical variables (clothing items, bedding items, flags): compare frequency in best vs all
- For numeric variables (room temp, meal time, sleep metrics): compare mean in best vs all
- Only surface differences where best-night values differ meaningfully from overall averages

---

## 10. Theme & Styling

### 10.1 App Identity

- **Name:** NightStack
- **Repo:** `nightstack`
- **Theme color:** `#1a1a2e` (deep navy — nighttime feel)
- **Accent color:** `#e2b714` (warm amber — like a bedside lamp)
- **Background (dark mode):** `#0f0f1a`
- **Background (light mode):** `#f5f5f0`
- **Default mode:** Dark (this is a nighttime app)

### 10.2 Icon

Generate an app icon that conveys sleep optimization / night science. Consider: a moon with stacked layers (representing the "stack"), or a crescent moon combined with a bar chart. Should look clean at 192px and 512px.

### 10.3 Design Notes

- Evening flow should use dark, warm tones — easy on the eyes at night
- Morning flow can be brighter
- Toggle buttons for clothing/bedding should be large and tappable (44px+ touch targets)
- Step-through forms should feel fast — minimize scrolling per step
- Charts should use the amber accent color for primary data series

---

## 11. Data Flow Diagrams

### 11.1 Evening Flow

```
User opens app (evening)
  → App checks day of week → loads default alarm from AlarmSchedule
  → App fetches weather from Open-Meteo
  → App evaluates SleepRules against conditions + recent history
  → Display Tonight's Plan (hero screen)
  → User confirms alarm (or overrides)
  → User taps "Start Evening Log"
  → Step-through: stack → food → environment → clothing → bedding → notes
  → Save NightLog (evening fields populated)
  → Schedule notifications based on confirmed alarm
```

### 11.2 Morning Flow

```
User opens app (morning)
  → Morning tab shows prompt to log last night
  → User imports Samsung Health JSON (file picker)
  → App validates and displays parsed SleepData
  → User confirms
  → User imports Govee CSV (file picker, optional)
  → App parses and displays room temp chart
  → User logs wake-up events (if any)
  → App checks if bedtime was late → shows explanation step if needed
  → User adds morning notes
  → Save NightLog (morning fields populated)
  → Dashboard/Insights update
```

---

## 12. Import Schemas

### 12.1 Samsung Health JSON Schema

The Claude project system prompt should instruct Claude to extract the following from a Samsung Health sleep screenshot and output it as JSON:

```
You are a data extraction assistant for the NightStack sleep tracking app.

When given a screenshot from Samsung Health's sleep tracking screen, extract the following fields and return ONLY valid JSON with no additional text:

{
  "sleepTime": "HH:MM (24hr, time user got in bed)",
  "wakeTime": "HH:MM (24hr, time user woke up)",
  "totalSleepDuration": "integer (total minutes including awake time)",
  "actualSleepDuration": "integer (actual sleep minutes, excludes awake)",
  "sleepScore": "integer (0-100)",
  "sleepScoreDelta": "integer (positive or negative change shown)",
  "deepSleep": "integer (minutes)",
  "remSleep": "integer (minutes)",
  "lightSleep": "integer (minutes)",
  "awakeDuration": "integer (minutes)",
  "avgHeartRate": "integer (bpm)",
  "avgRespiratoryRate": "float (breaths/min)",
  "bloodOxygenAvg": "integer (percent)",
  "skinTempRange": "string (e.g., '-2.5 to +2.1°F')",
  "sleepLatencyRating": "Excellent|Good|Fair|Attention",
  "restfulnessRating": "Excellent|Good|Fair|Attention",
  "deepSleepRating": "Excellent|Good|Fair|Attention",
  "remSleepRating": "Excellent|Good|Fair|Attention",
  "wakeUpEvents": [
    {
      "startTime": "HH:MM (24hr, when the wake-up began)",
      "endTime": "HH:MM (24hr, when fell back asleep, empty string if unknown)",
      "cause": "string (leave empty — user will select cause in the app)"
    }
  ]
}

If any field is not visible in the screenshot, set it to null.
Convert all durations to minutes.
Use 24-hour time format.

For wakeUpEvents: examine the sleep stages chart for significant awake periods (shown as gaps or "Awake" segments in the hypnogram). Include each distinct awake period that is clearly visible. Estimate startTime and endTime from the chart's time axis. If no significant awake periods are visible, set wakeUpEvents to an empty array []. Do not include the final morning wake-up as a wake-up event.
```

### 12.2 Govee CSV Parsing

Expected columns: `Timestamp`, `Temperature(°F)` or `Temperature(℉)`, `Humidity(%)`

Parser should:
- Auto-detect delimiter (comma or tab)
- Handle both °F and ℃ column headers (convert ℃ to °F if needed)
- Filter readings to the overnight window for the NightLog date
- Tolerate missing rows gracefully

---

## 13. BDD Feature Files

### 13.1 Domain Features

```
tests/features/
├── tonight-plan.feature
├── evening-log.feature
├── morning-log.feature
├── samsung-import.feature
├── govee-import.feature
├── wake-up-events.feature
├── rules-engine.feature
├── correlations.feature
├── best-nights.feature
├── notifications.feature
├── alarm-schedule.feature
├── supplement-stack.feature
├── clothing-bedding.feature
└── data-management.feature
```

### 13.2 Key Scenarios

**tonight-plan.feature:**

```gherkin
Feature: Tonight's Plan

  Scenario: Display tonight's plan with correct schedule
    Given tomorrow is Tuesday
    And the alarm schedule has Tuesday at 4:43 AM
    When I open the Tonight tab
    Then I see "4:43 AM alarm"
    And target bedtime is "9:13 PM"
    And eating cutoff is "6:43 PM"

  Scenario: Override alarm time
    Given tomorrow is Tuesday with default alarm 4:43 AM
    When I tap the alarm time
    And I change it to 5:30 AM
    Then target bedtime recalculates to "10:00 PM"
    And eating cutoff recalculates to "7:30 PM"

  Scenario: Weather-based recommendation
    Given the overnight forecast low is 28°F
    And the room temperature is 64°F
    When I view tonight's plan
    Then I see no recommendation to reduce bedding

  Scenario: Late eating warning
    Given the eating cutoff is 6:30 PM
    And the current time is 7:45 PM
    When I open the Tonight tab
    Then I see a warning "Past eating cutoff — try to stop eating now"
```

**evening-log.feature:**

```gherkin
Feature: Evening Log

  Scenario: Log with base stack unchanged
    When I reach the supplement stack step
    And I toggle "Took as planned"
    Then all supplements are checked
    And no deviation form is shown

  Scenario: Log a stack deviation
    When I reach the supplement stack step
    And I toggle off "Took as planned"
    And I tap "Magnesium Glycinate"
    And I select "reduced" with note "took 200mg instead of 400mg"
    Then the deviation is recorded

  Scenario: Every-other-day supplement pre-check
    Given yesterday's log shows Iron Bisglycinate was taken
    When I reach the supplement stack step
    Then Iron Bisglycinate is pre-unchecked (off day)

  Scenario: Flag late meal
    Given the eating cutoff is 6:30 PM
    When I enter last meal time as 8:15 PM
    Then the "late_meal" flag is auto-activated
    And an amber warning is displayed
```

**morning-log.feature:**

```gherkin
Feature: Morning Log

  Scenario: Import Samsung Health JSON successfully
    When I tap "Import Sleep JSON"
    And I select a valid JSON file
    Then the parsed sleep data summary is displayed
    And I can confirm to save it

  Scenario: Reject invalid Samsung Health JSON
    When I tap "Import Sleep JSON"
    And I select a JSON file missing required fields
    Then an error message explains what's missing
    And I can try again

  Scenario: Log wake-up event manually
    When I toggle "Did you wake up during the night?" to yes
    And I add a wake-up event with start time 3:15 AM and end time 3:40 AM
    And I select cause "Heart racing / palpitations"
    And I select "eventually" for fell back asleep
    And I enter 25 minutes to fall back asleep
    Then the wake-up event is saved to the NightLog with startTime and endTime

  Scenario: Wake-up events auto-populated from JSON import
    When I import a JSON file containing a wakeUpEvents array
    Then the "Did you wake up during the night?" toggle is set to yes
    And the wake-up events are pre-filled with startTime, endTime, and matched cause
    And I can edit, delete, or add more events before saving

  Scenario: Bedtime explanation shown only when late
    Given the Samsung Health data shows sleep time 11:23 PM
    And the target bedtime was 9:00 PM
    Then the bedtime explanation step is shown
    And it displays "You went to bed at 11:23 PM. Target was 9:00 PM."

  Scenario: Bedtime explanation skipped when on target
    Given the Samsung Health data shows sleep time 9:15 PM
    And the target bedtime was 9:30 PM
    Then the bedtime explanation step is skipped
```

**rules-engine.feature:**

```gherkin
Feature: Rules Engine

  Scenario: Seeded rules appear on first launch
    Given the app is freshly installed
    When I open the sleep rules settings
    Then I see 10 seeded rules
    And all are marked as active
    And all are labeled "Seeded"

  Scenario: Deactivate a seeded rule
    When I toggle off the "Peanut moderation" rule
    Then it no longer appears in Tonight's Plan recommendations

  Scenario: Add a custom rule
    When I tap "Add Rule"
    And I enter name "No screen after 9 PM"
    And I enter condition "Always"
    And I enter recommendation "Put phone away by 9 PM for better melatonin"
    And I select priority "Medium"
    Then the rule is saved and labeled "User"

  Scenario: Cannot delete seeded rules
    When I view a seeded rule
    Then there is no delete option
    But I can deactivate it
```

---

## 14. Implementation Notes

### 14.1 Offline-First

- All data stored in IndexedDB via Dexie
- Weather fetch is the only network call — cache aggressively and degrade gracefully if offline
- Samsung Health JSON and Govee CSV imports work entirely offline (file picker)

### 14.2 Performance

- NightLog queries should use the `date` index for fast lookups
- Dashboard charts should lazy-load and compute on render, not pre-compute
- Limit correlation scatter plots to last 90 days of data by default (configurable)

### 14.3 Mobile-First Design

- All touch targets 44px+
- Step-through forms use full-screen cards — no long scrolling forms
- Bottom sheet pattern for quick selectors (time picker, cause picker)
- Swipe navigation between evening/morning log steps

### 14.4 Future Considerations (Not in v1)

- Direct Claude API integration for screenshot extraction in-app
- Govee API integration when it stabilizes for sensors
- Samsung Health direct data access (if API becomes available)
- Apple Health / Google Fit integration
- Multi-user support (e.g., Grace tracking her sleep too)
- Machine learning-based recommendation engine replacing simple rules
- Wearable-based real-time alerts (e.g., "your heart rate just spiked")
