# Contributing to Optical Flash Time Transmission

Thank you for your interest in contributing to **Optical Flash Time Transmission**!
Whether you are reporting real-world test results with a watch, improving hardware compatibility, fixing a bug, or refining translations, your help is welcome.

Please note that this project follows a [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

---

## Ways to Contribute

- **Test on real hardware:** Report whether Rear LED Flashlight or Screen / Monitor Flash works with your watch, phone, browser, and timing settings using the **Watch Compatibility Report** issue template.
- **Report bugs:** Share device/browser details, timing settings, and steps to reproduce using the **Bug Report** issue template.
- **Suggest enhancements:** Propose UI, accessibility, protocol, or compatibility improvements via the **Feature Request** issue template.
- **Submit pull requests:** Fix bugs, add unit tests, improve mobile/desktop UX, or refine English/Polish translations.

---

## Local Development Setup

This project is a **zero-dependency, 100% client-side** static ES-module web application deployed directly on GitHub Pages. No bundler or build step is required.

### Prerequisites

- **Node.js 18+** (for running the built-in `node --test` unit test suite and syntax checks)
- Any local static HTTP server (for example, `python -m http.server 8080`)

### Running Locally

```bash
# Clone your fork
git clone https://github.com/<your-username>/optical-flash-time-transmission.git
cd optical-flash-time-transmission

# Serve locally (camera / rear LED torch requires localhost or HTTPS)
python -m http.server 8080
```

Then open `http://localhost:8080/` in your browser.

### Running Tests & Checks

```bash
# Run unit tests
node --test tests/wop-protocol.test.mjs

# Verify JavaScript syntax
node --check js/wop-protocol.js js/timezone-utils.js js/flash-driver.js js/feedback.js js/time-sync.js js/i18n.js js/app.js sw.js
```

---

## Project Guidelines

1. **Keep it zero-dependency and client-side:** Do not introduce build pipelines, runtime npm dependencies, external CDNs, tracking scripts, or third-party backend APIs.
2. **Respect clean-room & copyright boundaries:** Never commit proprietary binaries (such as APK files), extracted proprietary assets, or copyrighted watch photographs. All code, icons, and diagrams must be original or properly licensed under MIT-compatible terms.
3. **Maintain bilingual support (EN & PL):** Any user-facing UI text added or changed in `index.html` or `js/app.js` must have matching keys in both `en` and `pl` dictionaries in `js/i18n.js`.
4. **Preserve WOP v2.4 protocol accuracy:** Changes to `js/wop-protocol.js` or `js/timezone-utils.js` must include focused unit tests in `tests/wop-protocol.test.mjs`. Be especially careful with CRC-8 calculation, bipolar 5-bit stuffing, UTC end-of-frame alignment, and DST payload encoding.
5. **Respect camera lifecycle & privacy:** Rear camera/torch tracks must always be released immediately after transmission, test blink, benchmark, mode switch, or tab hide. Never request or store video frames beyond the live local alignment preview.
6. **Bump cache-busting versions when editing static assets:** GitHub Pages serves static files with a 10-minute cache header and the PWA uses a Service Worker. When modifying `styles.css`, `js/*.js`, or cached assets, increment the `?v=N` query strings in `index.html` and `js/app.js` together with `CACHE_NAME` and `APP_ASSETS` in `sw.js`.

---

## Pull Request Process

1. Fork the repository and create a descriptive branch from `main` (e.g., `fix/android-torch-timeout` or `feat/screen-contrast-mode`).
2. Keep pull requests focused and atomic.
3. Run `node --test tests/wop-protocol.test.mjs` and verify your changes in a browser (both desktop and mobile viewport).
4. Open a pull request against `main` and complete the pull request checklist.
