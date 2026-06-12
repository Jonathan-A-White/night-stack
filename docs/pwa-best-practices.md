# PWA Best Practices

A practical guide for building Progressive Web Apps that feel native on both iOS and Android. Derived from real-world lessons shipping a production PWA.

> **Stack assumptions:** Examples use Vite + `vite-plugin-pwa` (Workbox), React, and Dexie for IndexedDB. The principles are general; the code is copy-paste ready for that stack.

---

## Table of Contents

1. [Web App Manifest](#1-web-app-manifest)
2. [Fullscreen & Display Modes](#2-fullscreen--display-modes)
3. [Install to Home Screen](#3-install-to-home-screen)
4. [iOS-Specific Requirements](#4-ios-specific-requirements)
5. [Safe Area & Notch Handling](#5-safe-area--notch-handling)
6. [Viewport Configuration](#6-viewport-configuration)
7. [Service Worker & Caching](#7-service-worker--caching)
8. [Offline-First Data Storage](#8-offline-first-data-storage)
9. [Auto-Save & Data Persistence](#9-auto-save--data-persistence)
10. [Icons & Splash Screens](#10-icons--splash-screens)
11. [Theme Color & Dark Mode](#11-theme-color--dark-mode)
12. [SPA Routing on Static Hosts](#12-spa-routing-on-static-hosts)
13. [Preventing Scroll & Bounce Issues](#13-preventing-scroll--bounce-issues)
14. [Native-Feel CSS](#14-native-feel-css)
15. [On-Screen Keyboard Handling](#15-on-screen-keyboard-handling)
16. [Testing Offline-First Logic](#16-testing-offline-first-logic)
17. [CI/CD: GitHub Actions to GitHub Pages](#17-cicd-github-actions-to-github-pages)
18. [Version Management](#18-version-management)
19. [Common Pitfalls](#19-common-pitfalls)

---

## 1. Web App Manifest

The manifest tells the browser how your app should behave when installed. Generate it at build time (vite-plugin-pwa does this from the `manifest` option) so it stays in sync with your build configuration.

### Required Fields

```json
{
  "name": "My App",
  "short_name": "MyApp",
  "description": "What the app does",
  "start_url": "/",
  "scope": "/",
  "display": "fullscreen",
  "orientation": "portrait",
  "theme_color": "#1a1a2e",
  "background_color": "#ffffff",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### Key Details

- **`short_name`** is what appears below the icon on the home screen. Keep it under 12 characters.
- **`start_url`** must be within `scope`. If deploying to a subdirectory (e.g., GitHub Pages), both must include the path prefix.
- **`background_color`** is shown on the splash screen before the app loads. Match it to your app's initial background.

### Subdirectory Deployments (e.g., GitHub Pages)

You don't need to inject absolute paths into the manifest. Relative values resolve against the manifest's own URL, so the same manifest works at any base path:

```json
{ "start_url": ".", "scope": "." }
```

With Vite, set `base` so all asset URLs get the path prefix:

```ts
// vite.config.ts
export default defineConfig({
  base: "/my-repo/", // GitHub Pages serves at username.github.io/my-repo/
});
```

---

## 2. Fullscreen & Display Modes

### Display Mode Options

| Mode | Browser UI | Status Bar | Use Case |
|------|-----------|------------|----------|
| `fullscreen` | Hidden | Hidden | Games, immersive apps |
| `standalone` | Hidden | Visible | Most apps (recommended default) |
| `minimal-ui` | Minimal nav | Visible | Apps that need a back button |
| `browser` | Full | Visible | Not really a PWA |

### Recommended: Use `display_override` for Fallback Chain

```json
{
  "display": "fullscreen",
  "display_override": ["fullscreen", "standalone"]
}
```

The browser tries each mode in `display_override` first, then falls back to `display`. This gives you fullscreen where supported with standalone as a graceful fallback.

### Detecting Display Mode in CSS

```css
/* Styles only applied when running as installed PWA */
@media (display-mode: standalone) {
  /* ... */
}

@media (display-mode: fullscreen) {
  /* ... */
}
```

### Detecting Display Mode in JavaScript

```js
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.matchMedia("(display-mode: fullscreen)").matches ||
  window.navigator.standalone === true; // iOS Safari
```

---

## 3. Install to Home Screen

### Install Criteria

Browsers show an install prompt when these criteria are met:

- Valid web app manifest with `name`, `icons`, `start_url`, `display`
- Served over HTTPS (or localhost)
- Registered service worker with a fetch handler
- User has engaged with the app (varies by browser)

### Custom Install Prompt

Capture the `beforeinstallprompt` event to control when and how the install banner appears:

```js
let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // Suppress the default browser prompt
  deferredPrompt = e;
  showYourCustomInstallButton();
});

// When user clicks your custom install button:
async function handleInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log(outcome === "accepted" ? "Installed" : "Dismissed");
  deferredPrompt = null;
}
```

### Detecting Installation

```js
window.addEventListener("appinstalled", () => {
  console.log("App was installed");
  deferredPrompt = null;
});
```

> **Note:** `beforeinstallprompt` is not supported on iOS Safari. iOS users must manually use "Add to Home Screen" from the share sheet. Consider showing instructions for iOS users.

---

## 4. iOS-Specific Requirements

iOS Safari has its own PWA model with separate meta tags. These are **required** for a proper iOS home screen experience:

```html
<!-- Enable fullscreen (standalone) mode on iOS -->
<meta name="apple-mobile-web-app-capable" content="yes" />

<!-- Status bar appearance: default | black | black-translucent -->
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />

<!-- App name shown under the icon on home screen -->
<meta name="apple-mobile-web-app-title" content="My App" />

<!-- Home screen icon (iOS ignores manifest icons) -->
<link rel="apple-touch-icon" href="/icon-192.png" />
```

### Status Bar Styles

| Value | Behavior |
|-------|----------|
| `default` | White status bar with black text |
| `black` | Black status bar with white text |
| `black-translucent` | Transparent status bar, content renders behind it |

**Use `black-translucent`** for fullscreen apps — it lets your content extend to the top of the screen. Pair it with safe area padding (see Section 5) to prevent content from hiding behind the status bar.

---

## 5. Safe Area & Notch Handling

Modern devices have notches, dynamic islands, rounded corners, and home indicators that can overlap your content.

### Enable Safe Area Support

The viewport meta tag must include `viewport-fit=cover`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

Without `viewport-fit=cover`, the `env(safe-area-inset-*)` values will always be `0`.

### Apply Safe Area Padding

```css
#root {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
```

### Where to Apply

- **Top inset**: Prevents content from going behind the status bar or notch
- **Bottom inset**: Prevents content from going behind the home indicator
- **Left/Right insets**: Needed for landscape orientation on notched devices

Apply safe area padding on your outermost layout container. Fixed-position elements (e.g., bottom navigation bars) also need their own safe area adjustments:

```css
.bottom-nav {
  padding-bottom: env(safe-area-inset-bottom);
}
```

---

## 6. Viewport Configuration

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

### Why Each Part Matters

- **`width=device-width`**: Matches the viewport to the device width (prevents desktop-width rendering on mobile)
- **`initial-scale=1.0`**: Prevents unexpected zoom on page load
- **`viewport-fit=cover`**: Tells the browser to extend content into safe areas (required for `env(safe-area-inset-*)` to work)

### Optional: Disable User Zoom

Only do this if your app truly doesn't benefit from zoom (e.g., a game or full-screen tool):

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no" />
```

---

## 7. Service Worker & Caching

### Auto-Update Registration

Use `registerType: "autoUpdate"` so users always get the latest version without manual intervention:

```js
// vite.config.ts
VitePWA({ registerType: "autoUpdate", /* ... */ })
```

```js
// App entry point
import { registerSW } from "virtual:pwa-register";

registerSW({ immediate: true });
```

`registerType: "autoUpdate"` makes the generated service worker call `skipWaiting()` and `clientsClaim()`, so a new version activates without waiting for all tabs to close. `immediate: true` registers the service worker as soon as the script runs instead of deferring to the window `load` event.

### Update UX: The Mid-Session Deploy Problem

Silent auto-update has one failure mode: if you deploy while a user has the app open, the new service worker activates and **replaces the precache**. Lazy-loaded chunks from the old build no longer exist, so the user's next route navigation can fail until they reload.

Two mitigations (the first is usually enough):

**1. Reload on chunk-load failure.** Vite fires a dedicated event when a dynamic import fails:

```js
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  window.location.reload(); // Picks up the new build
});
```

This is safe when auto-save (Section 9) means a reload loses nothing.

**2. Prompt instead of auto-updating.** If a surprise reload could interrupt in-progress user state, use `registerType: "prompt"` and show a "New version available" toast:

```js
const updateSW = registerSW({
  onNeedRefresh() {
    // Show a toast; on click, activate the new SW and reload
    showUpdateToast(() => updateSW(true));
  },
});
```

The trade-off: users who never tap the toast stay on the old version indefinitely. Prefer `autoUpdate` + the reload-on-error handler unless you have long-lived unsaved state.

### Workbox Caching Strategy

```js
workbox: {
  // Precache all static assets
  globPatterns: ["**/*.{js,css,html,ico,png,svg,wasm}"],

  // SPA fallback: serve index.html for all navigation requests
  navigateFallback: "index.html",

  // Exclude special routes from the fallback (e.g., API endpoints)
  navigateFallbackAllowlist: [/^(?!\/__).*/],
}
```

### What to Precache

- HTML, CSS, JS bundles
- App icons and images
- Fonts (if self-hosted)
- Any static assets needed for first render

### What NOT to Precache

- API responses (use runtime caching instead)
- User-uploaded content
- Large media files (cache on demand)

### Runtime Caching (Optional)

```js
runtimeCaching: [
  {
    urlPattern: /^https:\/\/api\.example\.com\/.*/i,
    handler: "NetworkFirst",
    options: {
      cacheName: "api-cache",
      expiration: { maxEntries: 50, maxAgeSeconds: 86400 },
    },
  },
]
```

---

## 8. Offline-First Data Storage

For apps that need to work fully offline, store data client-side using IndexedDB. **Do not rely on `localStorage`** for structured data — it's synchronous, has a 5-10 MB limit, and can be cleared by the browser under storage pressure.

### Recommended: Dexie (IndexedDB Wrapper)

```js
import Dexie from "dexie";

class AppDatabase extends Dexie {
  items; // Table<Item, string>

  constructor() {
    super("MyAppDB");
    this.version(1).stores({
      items: "id, status, updatedAt",
    });
  }
}

export const db = new AppDatabase();
```

### Storage Limits

| Storage | Limit | Persistent? |
|---------|-------|-------------|
| `localStorage` | 5-10 MB | Cleared under pressure |
| IndexedDB | 50%+ of disk | Covered by `persist()` |
| Cache API | 50%+ of disk | Covered by `persist()` |

`navigator.storage.persist()` applies to the whole origin — IndexedDB, Cache API, and `localStorage` together.

### Request Persistent Storage

```js
if (navigator.storage && navigator.storage.persist) {
  const granted = await navigator.storage.persist();
  console.log(granted ? "Storage is persistent" : "Storage may be cleared");
}
```

Chrome grants this automatically for installed PWAs. Note that Safari deletes **all** script-writable storage (including IndexedDB) for sites the user hasn't interacted with in 7 days — installed home-screen apps are exempt, which is one more reason to push iOS users toward Add to Home Screen.

### Export & Import: The User's Only Backup

For a purely local app, the device **is** the database — a lost phone or a cleared browser profile means lost data. Give users a way out:

```js
async function exportData() {
  const payload = {
    schemaVersion: db.verno,
    exportedAt: new Date().toISOString(),
    items: await db.items.toArray(),
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `myapp-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importData(file) {
  const payload = JSON.parse(await file.text());
  // Validate schemaVersion and migrate if needed before writing
  await db.items.bulkPut(payload.items);
}
```

Include a schema version in the export so old backups can be migrated on import. For whole-database dumps across many tables, the `dexie-export-import` addon handles this generically. A versioned export format is also the natural seam if you later add sync — the export payload is already your wire format.

---

## 9. Auto-Save & Data Persistence

Users expect mobile apps to save automatically. Implement debounced auto-save to prevent excessive writes while ensuring no data is lost.

### Pattern: Debounced Auto-Save with Flush on Unmount

```js
function useAutoSave(recordId, delay = 500) {
  const timerRef = useRef(undefined);
  const pendingRef = useRef(undefined);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pendingRef.current) {
      db.items.update(pendingRef.current.id, pendingRef.current.changes);
      pendingRef.current = undefined;
    }
  }, []);

  const save = useCallback(
    (changes) => {
      if (!recordId) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingRef.current = { id: recordId, changes };
      timerRef.current = setTimeout(() => {
        db.items.update(recordId, changes);
        pendingRef.current = undefined;
      }, delay);
    },
    [recordId, delay],
  );

  // Flush pending changes on unmount — prevents data loss on navigation
  useEffect(() => () => flush(), [flush]);

  return { save, flush };
}
```

### Key Lesson: Always Flush on Unmount

If a user navigates away while a debounce timer is pending, that data is lost. Always flush pending writes in your cleanup function.

### Consider Immediate Save for Critical Actions

For high-stakes interactions (e.g., submitting an answer, completing a step), bypass debounce and save immediately:

```js
const saveImmediate = useCallback(
  (changes) => {
    if (!recordId) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = undefined;
    db.items.update(recordId, changes);
  },
  [recordId],
);
```

---

## 10. Icons & Splash Screens

### Required Icons

At minimum, provide:

| Size | Purpose | Notes |
|------|---------|-------|
| 192x192 | Standard icon | Used by Android and desktop |
| 512x512 | High-res icon | Used for splash screens and app stores |
| 512x512 (maskable) | Adaptive icon | Android applies circular/shaped masks |
| SVG | Favicon | Scalable, small file size |

### Maskable Icons

Android uses "maskable" icons to apply platform-specific shapes (circles, squircles, etc.). The important content must fit within the **safe zone** — the inner 80% of the icon.

```json
{
  "src": "icon-512.png",
  "sizes": "512x512",
  "type": "image/png",
  "purpose": "maskable"
}
```

Test your maskable icon at [maskable.app](https://maskable.app/).

### iOS Icons

iOS ignores manifest icons entirely. You **must** use a `<link>` tag:

```html
<link rel="apple-touch-icon" href="/icon-192.png" />
```

If not provided, iOS will use a screenshot of your app as the icon.

### Splash Screens

Android generates the splash screen automatically from the manifest's `background_color`, `name`, and 512px icon — no extra work. iOS ignores this and shows a plain background unless you provide `apple-touch-startup-image` links, which require one image **per device size and orientation**. Don't hand-author these; if you want iOS splash screens, generate them with [pwa-asset-generator](https://github.com/elegantapp/pwa-asset-generator). Otherwise, just make sure `background_color` matches your app's initial paint so the transition is seamless on Android.

---

## 11. Theme Color & Dark Mode

### Theme Color

The `theme-color` meta tag colors the browser's address bar and task switcher:

```html
<meta name="theme-color" content="#1a1a2e" />
```

Also set it in the manifest:

```json
{ "theme_color": "#1a1a2e" }
```

### Dark Mode

Respect the user's system preference, but allow manual override:

```js
function getInitialTheme() {
  // Check for saved preference first
  const stored = localStorage.getItem("app-theme");
  if (stored === "dark" || stored === "light") return stored;
  // Fall back to system preference
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}
```

### Dynamic Theme Color for Dark Mode

Update the theme-color meta tag when the theme changes:

```js
document.querySelector('meta[name="theme-color"]')
  .setAttribute("content", isDark ? "#111827" : "#1a1a2e");
```

---

## 12. SPA Routing on Static Hosts

SPAs with client-side routing break on static hosts (like GitHub Pages) when users refresh or deep-link to a route — the server returns a 404 because the path doesn't exist as a file.

### Solution: 404 Redirect Trick

**`404.html`** — Redirects all 404s back to the app:

```html
<script>
  var pathSegmentsToKeep = 1; // Set to 0 for root domain, 1 for subdirectory
  var l = window.location;
  l.replace(
    l.protocol + "//" + l.hostname + (l.port ? ":" + l.port : "") +
    l.pathname.split("/").slice(0, 1 + pathSegmentsToKeep).join("/") + "/?/" +
    l.pathname.slice(1).split("/").slice(pathSegmentsToKeep).join("/").replace(/&/g, "~and~") +
    (l.search ? "&" + l.search.slice(1).replace(/&/g, "~and~") : "") +
    l.hash
  );
</script>
```

**`index.html`** — Decodes the `?/...` query back into the real URL (must run **before** your router initializes):

```html
<script>
  (function (l) {
    if (l.search[1] === "/") {
      var decoded = l.search
        .slice(1)
        .split("&")
        .map(function (s) {
          return s.replace(/~and~/g, "&");
        })
        .join("?");
      window.history.replaceState(null, null, l.pathname.slice(0, -1) + decoded + l.hash);
    }
  })(window.location);
</script>
```

These two scripts are a matched pair (the [spa-github-pages](https://github.com/rafgraph/spa-github-pages) technique) — the 404 page encodes the path into the query string, and index.html decodes it with `history.replaceState` so the router sees the original URL. Don't mix snippets from different variants of this trick; the encoding and decoding must agree.

### Service Worker Alternative

If you have a service worker with `navigateFallback: "index.html"`, it will handle this for repeat visits. But the 404 trick is still needed for the **first visit** before the service worker is installed.

---

## 13. Preventing Scroll & Bounce Issues

Fullscreen PWAs commonly suffer from unwanted scrolling, rubber-band bounce, and visible gaps around safe areas.

### Lock Body Scrolling

Prevent the `<body>` from scrolling — only allow scrolling inside your app container:

```css
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
}

#root {
  height: 100svh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
```

### Why `100svh` Instead of `100vh`

On mobile browsers, `100vh` includes the area behind the browser's address bar, which causes content to overflow when the bar is visible. `100svh` (small viewport height) equals the visible area when the browser chrome is fully shown — it never overflows.

### Background Color Behind Safe Areas

When using `viewport-fit=cover` with `black-translucent` status bar, the area behind the safe area padding is visible. Set a background color on your app container:

```css
#root {
  background-color: #f8f9fa;
}

.dark #root {
  background-color: #111827;
}
```

Without this, you'll see a white (or transparent) bar at the top and bottom of the screen on notched devices.

### Use `min-h-full` Instead of `min-h-screen` on Pages

If pages use `min-h-screen`, they'll overflow the app container and cause double scrollbars. Use `min-h-full` to fill only the available space within the scroll container.

---

## 14. Native-Feel CSS

A handful of CSS defaults betray "this is a web page" the moment someone touches the screen. Override them globally:

```css
html, body {
  /* Disable pull-to-refresh and overscroll glow/bounce (Android Chrome) */
  overscroll-behavior: none;
}

* {
  /* Remove the grey/blue flash on tap */
  -webkit-tap-highlight-color: transparent;
}

button, a, [role="button"] {
  /* Remove the double-tap-to-zoom delay on interactive elements */
  touch-action: manipulation;
}
```

### Text Selection

Long-pressing a button and getting a text-selection caret feels broken. Disable selection on UI chrome, but **keep it for content and inputs**:

```css
.app-chrome, button, nav {
  user-select: none;
  -webkit-user-select: none; /* Still needed on iOS Safari */
}

input, textarea, [contenteditable], .user-content {
  user-select: text;
  -webkit-user-select: text;
}
```

On iOS, also suppress the long-press callout menu on images and links if they're UI elements:

```css
img {
  -webkit-touch-callout: none;
  -webkit-user-drag: none;
}
```

### Sticky Hover

On touch screens, `:hover` styles activate on tap and **stay stuck** until the user taps elsewhere — a highlighted button that won't un-highlight. Gate hover styles behind a capability query and use `:active` for touch feedback:

```css
@media (hover: hover) {
  .button:hover { background: #e5e7eb; }
}

.button:active { background: #d1d5db; }
```

---

## 15. On-Screen Keyboard Handling

The virtual keyboard is the biggest cross-platform behavioral difference left in PWAs:

- **Android Chrome (108+):** by default the keyboard resizes only the *visual* viewport — your layout, `100svh`, and `position: fixed` elements don't move, so a fixed bottom bar ends up **hidden behind the keyboard**.
- **iOS Safari:** the keyboard always overlays the page; the layout never resizes.

### Android: Opt Back Into Layout Resize

If your layout should shrink when the keyboard opens (usually what you want for chat-style UIs with a bottom input), add `interactive-widget` to the viewport meta tag:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
```

This is Chromium-only; iOS ignores it.

### Cross-Platform: Track the Visual Viewport

For full control on both platforms, mirror `visualViewport` into a CSS variable and size keyboard-sensitive UI with it:

```js
function syncViewportHeight() {
  const vv = window.visualViewport;
  document.documentElement.style.setProperty("--vvh", `${vv.height}px`);
}
window.visualViewport.addEventListener("resize", syncViewportHeight);
syncViewportHeight();
```

```css
.chat-screen {
  height: var(--vvh, 100svh); /* Shrinks when the keyboard opens */
}
```

A simpler alternative for fixed bottom navigation: hide it while any input is focused (`focusin`/`focusout` on the container) instead of trying to reposition it.

### Prevent iOS Zoom-on-Focus

iOS Safari zooms the page when a focused input's font-size is below 16px, and in a PWA there's no pinch-out escape. Keep inputs at 16px or larger:

```css
input, select, textarea {
  font-size: 16px;
}
```

---

## 16. Testing Offline-First Logic

The highest-value tests in an offline-first PWA are the data layer: importers, dedupe, migrations, derived analytics — pure logic that reads and writes IndexedDB. With `fake-indexeddb`, your real Dexie code runs unmodified in Vitest, no browser needed:

```ts
// vite.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
  // ...
});
```

```ts
// src/test/setup.ts
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto"; // In-memory IndexedDB — Dexie works as-is
```

Tests then import the real database module:

```ts
import { db } from "../db";
import { importRecords } from "../services/importer";

beforeEach(async () => {
  await db.items.clear(); // Isolate tests within a file
});

it("dedupes records imported twice", async () => {
  await importRecords([record, record]);
  expect(await db.items.count()).toBe(1);
});
```

### What This Buys You

- Schema definitions and Dexie migrations are exercised on every test run — a broken `version(n).stores()` upgrade fails loudly in CI instead of on a user's device.
- Import/export round-trips (Section 8) become trivially testable.

### What It Doesn't Cover

Service worker behavior, install flow, and caching are not exercised by unit tests. Verify those manually in Chrome DevTools (Application tab → Service Workers, with "Offline" throttling), and on a real device before relying on them.

---

## 17. CI/CD: GitHub Actions to GitHub Pages

One workflow handles both validation and deployment: every push and PR runs typecheck + tests + build; only pushes to `main` deploy.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: Type check
        run: npx tsc --noEmit
      - name: Run tests
        run: npm test
      - name: Build
        run: npm run build
      - name: Upload artifact
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### Why This Shape

- **Typecheck as its own step** (`tsc --noEmit` before the build) so type errors fail with a clear step name instead of being buried in build output.
- **Deploy is gated on `needs: test` and main-push-only** — PRs get full validation but can never deploy.
- **Official Pages actions** (`upload-pages-artifact` + `deploy-pages`) deploy via OIDC, which is why `pages: write` and `id-token: write` permissions are needed. No `gh-pages` branch, no deploy keys.
- **`concurrency: group: pages`** prevents two merges from deploying simultaneously out of order.
- **`cache: npm` + `npm ci`** gives fast, reproducible installs from the lockfile.

One PWA-specific consequence: every merge to `main` is a production deploy, which immediately triggers a service worker update for any user with the app open. Make sure your update flow handles that (Section 7).

---

## 18. Version Management

Inject the version at build time so users can see what version they're running (helpful for bug reports and cache debugging):

```js
// vite.config.ts
const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
```

```js
// In your app
const version = __APP_VERSION__; // "1.0.7"
```

Display the version in a Settings or About page. When users report issues, you can immediately tell if they're running a stale cached version.

---

## 19. Common Pitfalls

### White Bars Around Content
**Cause:** Safe area padding with no background color on the app container.
**Fix:** Set `background-color` on `#root` to match your app theme (see Section 13).

### App Shows Old Content After Deploy
**Cause:** Service worker serving stale cached assets.
**Fix:** Use `registerType: "autoUpdate"` with `immediate: true` so the new SW activates immediately.

### Double Scrollbars on Mobile
**Cause:** Both `<body>` and the app container allow scrolling.
**Fix:** Set `overflow: hidden` on `html, body` and only allow `overflow-y: auto` on your app root (see Section 13).

### iOS Doesn't Show Install Banner
**Cause:** iOS Safari doesn't support `beforeinstallprompt`.
**Fix:** Show manual instructions ("Tap Share > Add to Home Screen") for iOS users.

### Content Hidden Behind Notch
**Cause:** Missing `viewport-fit=cover` or missing safe area padding.
**Fix:** Add both (see Sections 5 and 6).

### Keyboard Pushes Layout Up on iOS
**Cause:** `100vh` changes when the keyboard opens on iOS.
**Fix:** Use `100svh` for the app container height.

### Manifest `scope` and `start_url` Mismatch
**Cause:** Deploying to a subdirectory without updating both values.
**Fix:** Dynamically set both based on your deployment environment (see Section 1).

### Data Lost Between Page Navigations
**Cause:** Debounced saves discarded when component unmounts.
**Fix:** Always flush pending writes in the cleanup function (see Section 9).

### Navigation Breaks Right After a Deploy
**Cause:** Auto-updated service worker replaced the precache while a user had the old build open; old lazy chunks no longer exist.
**Fix:** Reload on `vite:preloadError`, or switch to a prompt-based update flow (see Section 7).

### Pull-to-Refresh Reloads the App
**Cause:** Default overscroll behavior on Android Chrome.
**Fix:** `overscroll-behavior: none` on `html, body` (see Section 14).

### Buttons Stay Highlighted After Tapping
**Cause:** `:hover` styles stick on touch screens until the next tap.
**Fix:** Wrap hover styles in `@media (hover: hover)`; use `:active` for touch feedback (see Section 14).

### Page Zooms When Focusing an Input (iOS)
**Cause:** Input font-size below 16px triggers Safari's auto-zoom.
**Fix:** Set `font-size: 16px` or larger on all inputs (see Section 15).

### Bottom Bar Hidden Behind the Keyboard (Android)
**Cause:** Modern Android Chrome doesn't resize the layout viewport for the keyboard by default.
**Fix:** Add `interactive-widget=resizes-content` to the viewport meta tag, or size the UI from `visualViewport` (see Section 15).

---

## Quick Reference Checklist

```
[ ] Manifest: name, short_name, icons (192, 512, 512 maskable), display, start_url, scope
[ ] Meta tags: viewport (viewport-fit=cover), theme-color, description
[ ] iOS meta tags: apple-mobile-web-app-capable, status-bar-style, title, apple-touch-icon
[ ] Service worker: registered, precaches static assets, navigateFallback for SPA
[ ] Safe areas: env(safe-area-inset-*) padding on root container
[ ] Scroll: body overflow hidden, root uses 100svh + overflow-y auto
[ ] Background color: set on #root to prevent white bars behind safe area padding
[ ] Offline storage: IndexedDB for data, Cache API for assets, persist() requested
[ ] Data backup: JSON export/import with schema version (local-only apps)
[ ] Auto-save: debounced writes with flush on unmount
[ ] Updates: mid-session deploy handled (vite:preloadError reload or update prompt)
[ ] Native feel: overscroll-behavior none, tap-highlight transparent, hover gated behind (hover: hover)
[ ] Keyboard: bottom UI tested with keyboard open on Android; inputs >= 16px font
[ ] Icons: 192px, 512px, 512px maskable, SVG favicon, apple-touch-icon link tag
[ ] HTTPS: required for service workers (localhost exempt)
[ ] SPA routing: 404.html redirect for static hosts
[ ] Subdirectory deploy: vite base set, manifest uses relative start_url/scope
[ ] Tests: data layer (importers, dedupe, migrations) covered via fake-indexeddb
[ ] CI: typecheck + tests + build on every PR; deploy gated to main
[ ] Version: injected at build time, displayed in-app
```
