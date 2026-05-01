# Polymarket Market Detector

A local browser app that scans Polymarket Gamma search results for open markets, then alerts when any outcome reaches your configured threshold and cents range.

## Run

```bash
npm start
```

Open `http://127.0.0.1:4173`.

## How it works

- Uses `https://gamma-api.polymarket.com/public-search` to discover active markets.
- Lets you choose sections such as Weather, Politics, Sports, Crypto, or All.
- Keeps the original weather behavior when no query is entered: it scans same-day weather temperature markets.
- Supports custom search text like `12 may`, `election`, or `bitcoin`.
- Reads Gamma `outcomes` and `outcomePrices`, which map option names to prices.
- Shows a browser notification, alert log entry, and sound when an option price is at or above the threshold and inside the selected cents range.
- Links to the Polymarket event/market so you can execute manually.

This app intentionally does not place trades. Polymarket execution requires authenticated trading endpoints and wallet-specific risk checks.
