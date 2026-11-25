<div align="center">

# Optical Flash Time Transmission

**Web-based optical flash transmitter (WOP v2.4) for setting time, date, timezone, and DST on the Longines Conquest V.H.P. GMT**

<p>
  <a href="https://cino893.github.io/optical-flash-time-transmission/">
    <img src="https://img.shields.io/badge/OPEN%20WEB%20APP-Launch%20Flash%20Transmitter-0b1a30?style=for-the-badge&labelColor=9a7b3e" alt="Open Web App — Launch Flash Transmitter" height="36" />
  </a>
</p>

<p>
  <a href="https://cino893.github.io/optical-flash-time-transmission/">https://cino893.github.io/optical-flash-time-transmission/</a>
</p>

<p>
  <img src="https://img.shields.io/badge/Protocol-WOP%20v2.4-0b1a30?style=flat-square" alt="Protocol WOP v2.4" />
  <img src="https://img.shields.io/badge/Languages-EN%20%7C%20PL-9a7b3e?style=flat-square" alt="Languages EN | PL" />
  <img src="https://img.shields.io/badge/Runtime-100%25%20Client--Side-1e6b4a?style=flat-square" alt="100% Client-Side" />
  <img src="https://img.shields.io/badge/Dependencies-Zero-5a6270?style=flat-square" alt="Zero Dependencies" />
</p>

</div>

---

> [!IMPORTANT]
> **Compatibility Notice (EN):** Currently this application supports **Longines Conquest V.H.P. GMT** (Flash Setting) only. It is unknown whether it will work with other watches.
>
> **Informacja o kompatybilności (PL):** Na razie aplikacja wspiera wyłącznie zegarek **Longines Conquest V.H.P. GMT** (Flash Setting) i nie wiadomo, czy będzie działać z innymi zegarkami.

<div align="center">
  <img src="./assets/conquest-vhp-gmt-diagram.svg" alt="Conquest V.H.P. GMT optical Flash Setting schematic showing the 4 hands and photodiode hidden in the 1 of 12" width="100%" />
</div>

---

## Why This Exists

The official legacy Flash Setting mobile application is no longer maintained and fails to install or operate reliably on many modern Android devices. This project provides a lightweight, open, browser-based replacement hosted on GitHub Pages that runs 100% locally in your browser with no backend and no tracking.

---

## Transmission Modes

| Mode | Availability | Notes |
| --- | --- | --- |
| **Phone Rear LED Flashlight *(Default)*** | Android (Chrome, Edge, Samsung Internet over HTTPS) | Primary mode matching the original app. Uses WebRTC `MediaTrackConstraints` (`torch`), optional rear camera alignment reticle, and rising-edge LED latency compensation. |
| **Screen / Monitor Flash** | Desktop PCs, laptops, iOS Safari, any browser | Full-screen pure black/white (`#000000` / `#FFFFFF`) optical flashing mode. Set brightness to 100%, dim room light, and hold the watch dial against the flashing area. |

---

## Quick Start

1. **Prepare the watch:** On your **Longines Conquest V.H.P. GMT**, press the crown briefly, then press and hold it for ~2 seconds until the hands move into Flash Setting reception mode.
2. **Open the web app:** Launch [Optical Flash Time Sync](https://cino893.github.io/optical-flash-time-transmission/) and switch language (**EN / PL**) if needed.
3. **Select timezone:** Pick **Home Time (T1)** or **Travel Time (T2)** — UTC time, date, standard offset, and yearly Summer/Winter DST transitions are computed automatically via the browser's IANA timezone database.
4. **Position & transmit:**
   - **Rear LED Flashlight *(Default)*:** Hold the phone's rear LED 2–5 cm directly above the photodiode hidden inside the **`1` of `12`** on the dial.
   - **Screen / Monitor Flash:** Set display brightness to 100% and hold the dial close to the flashing white/black area.
5. Tap **Transmit** and keep steady for ~2–4 seconds until the hands adjust.

*(Advanced timing calibration — bit period, LED turn-on offset, manual UTC override, and live protocol frame inspector — is kept discreetly collapsed at the bottom of the page.)*

---

## WOP v2.4 Optical Protocol Specification

Reverse-engineered clean-room specification implemented in [`js/wop-protocol.js`](./js/wop-protocol.js):

| Layer / Field | Size | Encoding & Details |
| --- | --- | --- |
| `ProtHeader` | 8 bits | `11101010` (`117 << 1`) |
| `ProtLength` | 4 bits | Sub-message count in `MultiMessage` (`0001` without DST, `0010` with DST) |
| `ProtOpcode` (1) | 8 bits | `57` (`00111001`) for Home `T1`, `58` (`00111010`) for Travel `T2` |
| `TimezonePayload` | 8 bits | `hourShift` (5b signed two's complement, `-12..+15`), `minuteShift` (2b: `0=0m`, `1=30m`, `2=45m`), `hemisphere` (1b: `0=North`, `1=South`) |
| `TimePayload` | 17 bits | UTC `hour` (5b, `0..23`), `minute` (6b, `0..59`), `second` (6b, `0..59`) synchronized to land on a whole UTC second |
| `DatePayload` | 16 bits | `year % 100` (7b, `0..99`), `month` (4b, `1..12`), `day` (5b, `1..31`) |
| `ProtOpcode` (2, optional) | 8 bits | `59` (`00111011`) for `T1` DST, `60` (`00111100`) for `T2` DST |
| `DstPayload` (optional) | 30 bits | Summer (15b) + Winter (15b): `season` (1b: `0=Summer`, `1=Winter`), `month` (4b), `day` (5b), `hour` (5b) |
| `CRC-8` | 8 bits | Polynomial `263` (`0x107`: x⁸ + x² + x + 1, init `0x00`) over all bits **after** `ProtHeader` |
| Bit stuffing | — | Bipolar 5-bit stuffing across the entire frame (after 5 consecutive identical bits, insert inverted bit; stuff bit counts as bit #1 of the next run) |
| Trailer | 2 bits | Two trailing zero bits (`00`) + 1 final bit period hold |
| Optical modulation | — | On-Off Keying (`1` = light ON, `0` = light OFF), default `30 ms` bit period (`10–100 ms` valid), optional rising-edge pre-compensation (`0 ms` Android, `8 ms` Apple) |

---

## Project Structure & Local Development

```text
├── index.html                           # Single-page web app (EN / PL)
├── styles.css                           # Classic horological styling
├── js/
│   ├── wop-protocol.js                  # WOP v2.4 frame encoder, CRC-8, bit stuffing & scheduling
│   ├── timezone-utils.js                # IANA timezone & automatic DST transition detector
│   ├── flash-driver.js                  # Rear LED torch driver + fullscreen screen/monitor flash
│   ├── i18n.js                          # English & Polish translations
│   └── app.js                           # Application state, live clocks & UI controller
├── assets/
│   └── conquest-vhp-gmt-diagram.svg     # Original vector schematic (4 hands & 1-of-12 sensor)
└── tests/
    └── wop-protocol.test.mjs            # Node.js unit test suite
```

```bash
# Run protocol & timezone unit tests (Node.js 18+)
node --test tests/wop-protocol.test.mjs

# Serve locally (camera/torch requires HTTPS or localhost)
python -m http.server 8080
```

---

## License

See [LICENSE](./LICENSE).
