# VELO LAB

Real-time ANT+ bike trainer monitor. Connects to any ANT+ fitness equipment (trainers, smart bikes) via USB stick and displays live power, speed, cadence, and heart rate in a browser dashboard.

<img width="1570" height="907" alt="velolab-antplus-monitor" src="https://github.com/user-attachments/assets/d826e7a2-808c-4865-ba1f-cba64df49893" />

## Requirements

- Node.js 22+
- ANT+ USB stick (Garmin, CYCPLUS, or compatible)
- ANT+ fitness equipment (FE-C profile)

## Setup

```
npm install
node server.js
```

Open `http://localhost:3000`.

## Platform notes

- **macOS** — Quit Garmin Express before starting (it claims the USB stick).
- **Linux** — Install `libusb`: `sudo apt-get install build-essential libudev-dev`.
- **Windows** — Install the WinUSB driver via [Zadig](https://zadig.akeo.ie/).

## Features

- Power zone coloring (Z1–Z7 based on FTP)
- Normalized Power and Intensity Factor
- Live power chart with zone-colored bars
- Auto-reconnect on USB disconnect
- No build step — vanilla HTML/JS/CSS

## License

MIT
