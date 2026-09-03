# Workstream: app-shell

**Blocked by:** `schema` (types only). **Blocks:** every UI workstream.

Q1 decision: three apps within the app — **Routine**, **Tracking**,
**Experiments** — each with its own tab bar, a top-level switcher, and
Settings shared. See `research.md` §8 for the route inventory and the
"do not move existing routes" recommendation this spec adopts.

## Scope

1. `src/apps.ts` — a registry: `AppId = 'routine' | 'tracking' |
   'experiments'`, and for each app its label, icon, home path, and
   tabs `{ path, label, icon }[]`. Pure, unit-testable.
2. `AppSwitcher` — a compact three-segment control rendered at the top
   of `.app-layout` (below the install banner). Tapping switches app
   and navigates to that app's home (or its last-visited tab path,
   remembered per app in `localStorage['nightstack-app-last-path']`).
3. `AppTabBar` replaces `BottomTabs`: renders the tabs of the **active
   app** (derived from the current pathname via `resolveAppForPath`),
   with Settings as the last tab in every app.
4. `/` redirects to the remembered app's home
   (`localStorage['nightstack-app']`, default `tracking`).
5. New home pages: `RoutineHome` (`/routine`) hosting the existing
   `RoutineStartCard` + a link to routine settings and analytics;
   `ExperimentsHome` (`/experiments`) with a large **Episode** button
   (wired by `episode-capture`), today's vitals/body status cards
   (placeholders until those workstreams land), and links to export
   and Samsung import.
6. PWA manifest `shortcuts` entry "Episode" → `./experiments/episode`.
7. **Force-dark** mechanism: a `.force-dark` wrapper class that
   redeclares the dark variables so the 4am flow is dark regardless
   of `data-theme` (research §8).
8. Existing routes are **not moved**. The Routine app's tabs point at
   `/routine` and `/tonight/routine`; Tracking's at `/tonight`,
   `/morning`, `/calendar`, `/insights`; Experiments' at
   `/experiments`, `/experiments/vitals`, `/experiments/body`,
   `/experiments/import`. Settings routes stay under `/settings`.

Tab layout:

| App | Tabs |
|---|---|
| Routine | Start (`/routine`), Tracker (`/tonight/routine`), Settings |
| Tracking | Tonight, Morning, Calendar, Insights, Settings |
| Experiments | Home (`/experiments`), Vitals, Body, Import, Settings |

## Non-goals

- Restyling pages; moving files between `src/pages/*` directories.
- Building the Experiments tab contents (owned by the capture
  workstreams; this workstream ships placeholder routes that render a
  "Coming soon" empty state so the shell is navigable end-to-end).
- Routine analytics changes.

## Data changes

None. `localStorage` keys: `nightstack-app` (AppId),
`nightstack-app-last-path` (JSON map AppId → path).

## UI changes

- `App.tsx`: wrap routes; add `/routine`, `/experiments`,
  `/experiments/vitals`, `/experiments/body`, `/experiments/import`,
  `/experiments/episode` (placeholders), `/settings/reminders`
  (placeholder until vitals lands); replace `<BottomTabs />` with
  `<AppTabBar />` and add `<AppSwitcher />`.
- `theme.css`: `.app-switcher` (segmented, 44 px tall, sticky top),
  `.force-dark` variable block, `.app-content` padding adjusted for the
  switcher height (`--switcher-height`).
- `SettingsHome`: add "Reminders" and "Vitals" rows (link targets may
  be placeholders until `vitals` lands).

## Given / When / Then

```gherkin
Feature: App registry

  Scenario: Every existing route resolves to an app
    Given the list of routes that existed at v11
    When resolveAppForPath is called for each
    Then /tonight/routine resolves to 'routine'
    And /tonight, /tonight/log, /morning/review/x, /calendar, /insights/metric/score resolve to 'tracking'
    And /settings and /settings/data/cleanup resolve to the last-active app (settings is shared)
    And no route resolves to undefined

  Scenario: Experiments routes resolve to experiments
    When resolveAppForPath('/experiments/vitals/new') is called
    Then it returns 'experiments'

Feature: Switcher and tab bar

  Scenario: Switching apps navigates to the app home
    Given the current path is /morning
    When the Experiments segment is tapped
    Then the location is /experiments
    And the tab bar shows Home, Vitals, Body, Import, Settings

  Scenario: Switching back restores the last tab
    Given the user visited /insights/correlations, then switched to Routine
    When the Tracking segment is tapped
    Then the location is /insights/correlations

  Scenario: Cold launch opens the remembered app
    Given localStorage nightstack-app is 'experiments'
    When the app loads at /
    Then it redirects to /experiments
    Given localStorage is empty
    Then it redirects to /tonight

  Scenario: Settings tab is present in every app and highlights correctly
    Given the current path is /settings/weight-profile
    Then the Settings tab is active and the switcher still shows the last-active app

Feature: Force dark

  Scenario: A force-dark subtree is dark under the light theme
    Given data-theme is 'light'
    When a page renders inside .force-dark
    Then its computed background is the dark background token
```

## Acceptance criteria

- `src/test/apps.test.ts` covers the registry scenarios (pure).
- A Testing Library test mounts `App` in a `MemoryRouter` at each of
  the v11 routes and asserts a page header renders (no blank screen).
- Manual: all 59 hard-coded links still work (spot-check the calendar
  → morning review → room conditions chain and settings sub-pages).
- PWA shortcut appears on Android long-press after reinstall (noted in
  PR; cannot be tested in CI).
- Lint, typecheck, tests, build green.

## Open questions

- Switcher placement: top segmented control (default) vs a long-press
  on the tab bar. Top is chosen for discoverability and one-thumb reach
  on the phone's upper half being acceptable for a rare action.
- Whether `/routine` should become the Routine app's default instead
  of the tracker itself; default is a home card since the tracker
  expects a variant selection.
