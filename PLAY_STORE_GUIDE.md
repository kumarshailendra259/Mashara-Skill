# Mashara Check-In → Play Store Publishing Guide (Option B: PWA Builder)

This guide walks you through publishing **https://finance.masharaskills.com/check-in** to the Google Play Store as a native Android app using [pwabuilder.com](https://www.pwabuilder.com) — the **easiest** path. Total time: ~2-3 hours (most of it Play Console paperwork).

---

## What's Already Done For You ✅

The codebase ships with everything PWA Builder needs to grade an A on its scorecard:

1. **`/app/frontend/public/manifest.json`** — full Play Store-ready manifest:
   - `id`, `name`, `short_name`, `description`, `categories`
   - `start_url: /check-in`, `scope: /`
   - `display: standalone` + `display_override` fallbacks
   - 8 PNG icons (72→512) + 2 maskable (192, 512)
   - 3 mobile screenshots (1080×1920 portrait)
   - App shortcut for "Check In"

2. **`/app/frontend/public/sw.js`** — service worker (cache-first for icons, network-first for HTML/API).

3. **`/app/frontend/public/index.html`** — registers SW, links manifest, sets theme color.

4. **`/app/frontend/public/icons/`** — 10 PNG files (no SVG, no base64).

5. **`/app/frontend/public/screenshots/`** — 3 portrait screenshots, ready for Play Store listing too.

After you **redeploy** (`https://finance.masharaskills.com` should serve the new manifest + icons), Lighthouse PWA score should be **100/100**.

---

## Step-by-Step Publishing

### Phase 1 — Verify the PWA (5 min)

1. Open **https://finance.masharaskills.com/check-in** on Chrome desktop.
2. DevTools → **Application** tab → **Manifest** — confirm no warnings.
3. DevTools → **Lighthouse** → run **PWA audit** — score should be ≥ 90.
4. Visit **https://www.pwabuilder.com**, paste your URL, click **Start**.
   - You should see 3 green badges: Manifest ✅, Service Worker ✅, Security ✅.

### Phase 2 — Generate Android Package (10 min)

1. On PWA Builder dashboard click **Package For Stores**.
2. Pick **Android** → **Generate Package**.
3. Fill in the form:
   - **Package ID:** `com.masharaskills.checkin` *(must be unique; never change after first publish)*
   - **App name:** `Mashara Check-In`
   - **Launcher name:** `Mashara`
   - **App version:** `1.0.0` (start)
   - **Version code:** `1`
   - **Signing key:** Choose **Generate new** *(PWA Builder will create one for you — DOWNLOAD AND SAVE the `.keystore` + password somewhere safe; you'll need it for every future update.)*
   - **Display mode:** Standalone
   - **Orientation:** Portrait
   - **Status bar color:** `#0a3bc5`
   - **Splash color:** `#ffffff`
4. Click **Download**. You'll get a ZIP with:
   - `app-release-signed.aab` ← upload this to Play Console
   - `signing.keystore` ← **GUARD THIS FILE WITH YOUR LIFE**
   - `assetlinks.json` ← upload to your server

### Phase 3 — Upload Digital Asset Links (5 min)

Without this, the app will show the browser URL bar (kills the "native feel").

1. From the ZIP, take `assetlinks.json`.
2. Upload it to your server at exactly: **https://finance.masharaskills.com/.well-known/assetlinks.json**
   - File must be served at that exact path with `Content-Type: application/json`.
   - Test by visiting that URL in browser — should return JSON.

### Phase 4 — Play Console Setup (45 min — one time)

1. Create developer account at **https://play.google.com/console** ($25 one-time fee).
2. Complete identity verification (passport / Aadhaar).
3. **All apps → Create app**:
   - App name: **Mashara Check-In**
   - Default language: English (India)
   - Type: App
   - Free
4. **Main store listing** (left sidebar):
   - Short description (max 80 chars): `Daily attendance with location & selfie for Mashara Skills staff`
   - Full description: paste a longer paragraph from your business write-up
   - **App icon** (512×512): upload `/icons/icon-512.png` from your build
   - **Feature graphic** (1024×500): you'll need to create one (Canva template works)
   - **Phone screenshots**: upload the 3 PNGs from `/screenshots/`
   - **Category:** Business
   - **Email:** your support email
   - **Privacy policy URL:** **REQUIRED** — see Phase 5
5. **App content** (left sidebar) — answer all questionnaires:
   - Privacy policy
   - Ads (None)
   - App access (Restricted — staff-only login)
   - Content rating (fill questionnaire → likely "Everyone")
   - Target audience (18+)
   - Data safety (declare: location, camera, login credentials)
   - Government apps (No)
   - News apps (No)
   - Financial features (No — internal SaaS)

### Phase 5 — Privacy Policy (15 min)

Play Store **mandates** a public privacy policy URL.

Quickest path:
1. Use a generator like **https://app-privacy-policy-generator.firebaseapp.com**
2. Fill: app name = Mashara Check-In, collected data = email, password, location, photos, device ID
3. Host the generated HTML at **https://finance.masharaskills.com/privacy.html** (or any public page).
4. Paste that URL into Play Console store listing.

### Phase 6 — Upload AAB & Roll Out (15 min)

1. Play Console left sidebar → **Production** → **Create new release**.
2. **App bundle**: upload `app-release-signed.aab` from PWA Builder ZIP.
3. **Release name**: `1.0.0`
4. **Release notes**:
   ```
   Initial release.
   • Staff attendance with selfie + GPS check-in
   • Monthly attendance history
   • Leave & reimbursement requests
   • Payroll viewing
   ```
5. **Save → Review → Send for review**.
6. Initial review takes **3-7 days**. If approved, app goes live on Play Store at:
   **https://play.google.com/store/apps/details?id=com.masharaskills.checkin**

---

## Updating the App Later

When you change web code:
- The PWA updates automatically (no Play Store re-submission needed) — that's the magic of TWA.

When you want to bump the Android shell (e.g. add Play Store description tweaks, change icons):
1. PWA Builder → re-generate package
2. Use **the same keystore** (upload it during signing — never use "Generate new" again)
3. Bump `versionCode` (e.g. 2) and `versionName` (e.g. 1.0.1)
4. Play Console → Production → Create new release → upload new AAB.

---

## Common Issues

| Symptom | Fix |
|---|---|
| App opens browser URL bar | `assetlinks.json` not deployed or wrong fingerprint. Re-upload from ZIP. |
| Manifest 404 in PWA Builder | Make sure you redeployed after this commit. |
| Icon shows as letter "M" only | Working as designed (placeholder). Replace `/icons/*.png` with your real logo at any time. |
| "App Bundle uses too low targetSdk" | PWA Builder targets latest by default. Just re-generate package. |
| Review rejection: "Misleading content" | Make sure store listing screenshots match what user actually sees. |

---

## Files in This Repo Relevant to Play Store

```
/app/frontend/public/
├── manifest.json              ← Play Store metadata (read by PWA Builder)
├── sw.js                      ← Service worker (PWA criterion)
├── index.html                 ← Registers SW, links manifest
├── icons/
│   ├── icon-72.png ... icon-512.png      ← App icons
│   └── icon-{192,512}-maskable.png       ← For Android adaptive icons
└── screenshots/
    ├── screenshot-1-login.png            ← Use these on Play Store listing
    ├── screenshot-2-checkin.png
    └── screenshot-3-history.png
```

**You don't need to install anything locally.** Everything is browser-based — PWA Builder does the Android build for you.

---

## Replace Placeholder Icons With Real Logo (Optional)

The current "M" icons are auto-generated placeholders. To use your real Mashara logo:

1. Get a square (1:1 aspect) PNG of your logo, at least 1024×1024 px.
2. Use **https://www.pwabuilder.com/imageGenerator** to bulk-generate all required sizes.
3. Replace files in `/app/frontend/public/icons/`.
4. For maskable variants: leave 10% safe-zone padding around your logo (Android trims the corners on round icons).
5. Redeploy → re-generate PWA Builder package → upload new AAB.

Same for screenshots — replace `/screenshots/*.png` with actual phone screenshots once the app is live.
