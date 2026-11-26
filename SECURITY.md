# Security Policy

## Supported Versions

This project is deployed continuously from the `main` branch to GitHub Pages. Only the latest version on `main` is actively maintained.

| Version | Supported |
| --- | --- |
| `main` (GitHub Pages latest) | Yes |
| Older commits / forks | No |

## Security & Privacy Architecture

**Optical Flash Time Transmission** is designed to minimize attack surface and preserve user privacy:

- **100% client-side:** All protocol encoding, timezone/DST calculations, and optical flashing run locally in the browser with zero external runtime dependencies.
- **No data collection:** No analytics, cookies, user accounts, or external API calls are made (optional UTC offset sync uses a same-origin `HEAD` request against the hosted static page).
- **Strict camera lifecycle:** Camera/torch access (`getUserMedia`) is requested only when explicitly triggered by the user in Rear LED mode, never leaves the device, and is released immediately after transmission, test blink, benchmark, or when the page is backgrounded.

## Reporting a Vulnerability

If you discover a security vulnerability (for example, XSS, Service Worker cache poisoning, unsafe permission handling, or unintended data exposure):

1. **Please do not open a public GitHub issue** for sensitive security vulnerabilities.
2. Instead, report it privately using **GitHub Private Vulnerability Reporting** under the repository's **Security** tab (`Security` → `Advisories` → `Report a vulnerability`), if enabled, or contact the maintainer (`@cino893`).
3. Include a clear description of the issue, affected files or browser versions, and steps to reproduce.

You can expect an initial acknowledgment within 7 days and a coordinated fix once verified.
