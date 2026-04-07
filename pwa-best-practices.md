# PWA Best Practices

A practical guide for building Progressive Web Apps that feel native on both iOS and Android. Derived from real-world lessons shipping a production PWA.

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
14. [Version Management](#14-version-management)
15. [Common Pitfalls](#15-common-pitfalls)

---

## 1. Web App Manifest

The manifest tells the browser how your app should behave when installed. Generate it at build time so you can inject environment-specific values (e.g., different `scope` for subdirectory deployments).

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
// Using vite-plugin-pwa
import { registerSW } from "virtual:pwa-register";

registerSW({ immediate: true });
```

The `immediate: true` option ensures the service worker activates immediately rather than waiting for all tabs to close.

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
| IndexedDB | 50%+ of disk | Can request persistence |
| Cache API | 50%+ of disk | Cleared under pressure |

### Request Persistent Storage

```js
if (navigator.storage && navigator.storage.persist) {
  const granted = await navigator.storage.persist();
  console.log(granted ? "Storage is persistent" : "Storage may be cleared");
}
```

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

**`index.html`** — Restores the original URL:

```html
<script>
  (function () {
    var redirect = sessionStorage.redirect;
    delete sessionStorage.redirect;
    if (redirect && redirect !== location.href) {
      history.replaceState(null, null, redirect);
    }
  })();
</script>
```

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

## 14. Version Management

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

## 15. Common Pitfalls

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
[ ] Offline storage: IndexedDB for data, Cache API for assets
[ ] Auto-save: debounced writes with flush on unmount
[ ] Icons: 192px, 512px, 512px maskable, SVG favicon, apple-touch-icon link tag
[ ] HTTPS: required for service workers (localhost exempt)
[ ] SPA routing: 404.html redirect for static hosts
[ ] Version: injected at build time, displayed in-app
```
