# Lake Mendota Buoy Dashboard

A fixed, no-scroll live dashboard for real-time buoy data collected by the UW-Madison
Center for Limnology (CFL) on Lake Mendota. Designed to run unattended on a display
(e.g. a lab monitor) — it fills the screen and auto-refreshes on its own.

## Layout

The screen is split 50/50:

- **Left sidebar** — a 2×3 grid of headline current conditions (surface temperature,
  bottom temperature, wind speed in mph, wind direction, air temperature, and relative
  humidity), with a photo of the buoy at the bottom.
- **Right side** — a live temperature-depth profile: depth on the y-axis, temperature
  on the x-axis, built from the most recent full sensor reading.

Data refreshes automatically about once a minute; there are no interactive controls.

## Project Structure

```
├── index.html   # Dashboard page
├── mendota.js   # Data fetching/parsing and the D3 profile plot
├── style.css    # Fixed-viewport dashboard layout and styling
└── assets/      # Logotype and buoy photos
```

## No-Data Modals

A modal shades the dashboard when data stops (no buttons — it clears itself once data returns):

- **Buoy offline** — no data for `OFFLINE_HOURS` (12).
- **Out for the winter** — no data for 7 days between Nov 1 and April 1, or forced with
  `FORCE_WINTER_MODAL = true` at the top of `mendota.js`.

While a modal is showing, the dashboard displays the last known conditions behind it.
