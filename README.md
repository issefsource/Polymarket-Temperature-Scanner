# Polymarket Weather Temperature Detector

A local browser app that scans Polymarket Gamma search results for open weather temperature markets on the selected scan date, then alerts when any outcome reaches your configured threshold, defaulting to 94 cents.

## Run

```bash
npm start
```

Open `http://127.0.0.1:4173`.

## How it works

- Uses `https://gamma-api.polymarket.com/public-search` to discover active markets.
- Filters for weather temperature wording and the selected date, including formats like `April 26`, `Apr 26`, and `2026-04-26`.
- Reads Gamma `outcomes` and `outcomePrices`, which map option names to prices.
- Shows a browser notification, alert log entry, and sound when an option price is at or above the threshold.
- Links to the Polymarket event/market so you can execute manually.

This app intentionally does not place trades. Polymarket execution requires authenticated trading endpoints and wallet-specific risk checks.
