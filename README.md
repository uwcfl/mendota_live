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
