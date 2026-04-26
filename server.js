const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const GAMMA_API = "https://gamma-api.polymarket.com";
const POLYMARKET_WEB = "https://polymarket.com";

const PUBLIC_DIR = path.join(__dirname, "public");
const MONTHS = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may", "may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sep"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"]
];

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[,?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMaybeJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return fallback;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function toLocalDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(input) {
  const match = String(input || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return parseDateInput(toLocalDateInput());
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return parseDateInput(toLocalDateInput());
  return { year, month, day, date };
}

function dateVariants(dateInput) {
  const { year, month, day } = parseDateInput(dateInput);
  const [fullMonth, shortMonth] = MONTHS[month - 1];
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const shortNumericMonth = String(month);
  const shortNumericDay = String(day);

  return [
    `${fullMonth} ${day}`,
    `${shortMonth} ${day}`,
    `${fullMonth} ${day} ${year}`,
    `${shortMonth} ${day} ${year}`,
    `${day} ${fullMonth}`,
    `${day} ${shortMonth}`,
    `${year}-${mm}-${dd}`,
    `${mm}/${dd}`,
    `${shortNumericMonth}/${shortNumericDay}`
  ];
}

function buildQueries(dateInput, customQuery) {
  if (customQuery && customQuery.trim()) {
    return [customQuery.trim()];
  }

  const { month, day, year } = parseDateInput(dateInput);
  const [fullMonth, shortMonth] = MONTHS[month - 1];
  const monthDay = `${fullMonth} ${day}`;
  const shortMonthDay = `${shortMonth} ${day}`;

  return [
    `temperature ${monthDay}`,
    `highest temperature ${monthDay}`,
    `weather temperature ${monthDay}`,
    `temperature ${shortMonthDay}`,
    `highest temperature ${monthDay} ${year}`
  ];
}

function hasWeatherTemperatureSignal(market, sourceEvent) {
  const haystack = normalizeText([
    market.question,
    market.title,
    market.groupItemTitle,
    market.description,
    market.category,
    sourceEvent && sourceEvent.title,
    sourceEvent && sourceEvent.description
  ].join(" "));

  return [
    "temperature",
    "temp",
    "degrees",
    "fahrenheit",
    "highest temperature",
    "high temperature"
  ].some((term) => haystack.includes(term));
}

function datePart(value) {
  if (!value) return "";
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function hasDateSignal(market, sourceEvent, variants, dateInput) {
  const marketEndDate = datePart(market.endDateIso || market.endDate);
  if (marketEndDate) return marketEndDate === dateInput;

  const haystack = normalizeText([
    market.question,
    market.title,
    market.groupItemTitle,
    market.slug,
    sourceEvent && sourceEvent.title,
    sourceEvent && sourceEvent.slug
  ].join(" "));

  return variants.some((variant) => haystack.includes(normalizeText(variant)));
}

function bestEvent(market, sourceEvent) {
  if (sourceEvent) return sourceEvent;
  if (Array.isArray(market.events) && market.events.length) return market.events[0];
  return null;
}

function marketUrl(market, event) {
  const eventSlug = market.eventSlug || (event && event.slug);
  if (eventSlug) return `${POLYMARKET_WEB}/event/${eventSlug}`;
  if (market.slug) return `${POLYMARKET_WEB}/market/${market.slug}`;
  return POLYMARKET_WEB;
}

function normalizeMarket(market, sourceEvent, threshold) {
  const event = bestEvent(market, sourceEvent);
  const outcomes = parseMaybeJson(market.outcomes);
  const prices = parseMaybeJson(market.outcomePrices);
  const tokenIds = parseMaybeJson(market.clobTokenIds);

  const options = outcomes.map((outcome, index) => {
    const price = Number(prices[index]);
    return {
      outcome: String(outcome),
      price: Number.isFinite(price) ? price : null,
      priceCents: Number.isFinite(price) ? Math.round(price * 10000) / 100 : null,
      tokenId: tokenIds[index] ? String(tokenIds[index]) : null,
      alerted: Number.isFinite(price) && price >= threshold
    };
  });

  const topOption = options.reduce((best, option) => {
    if (option.price == null) return best;
    if (!best || option.price > best.price) return option;
    return best;
  }, null);

  return {
    id: String(market.id || market.conditionId || market.slug || ""),
    conditionId: market.conditionId || null,
    slug: market.slug || null,
    question: market.question || market.title || market.groupItemTitle || "Untitled market",
    eventTitle: event && event.title ? event.title : null,
    eventSlug: event && event.slug ? event.slug : market.eventSlug || null,
    active: market.active !== false,
    closed: market.closed === true,
    enableOrderBook: market.enableOrderBook === true,
    acceptingOrders: market.acceptingOrders !== false,
    endDate: market.endDateIso || market.endDate || null,
    volume24hr: Number(market.volume24hr || market.volume24hrClob || 0),
    liquidity: Number(market.liquidityNum || market.liquidity || 0),
    url: marketUrl(market, event),
    options,
    topOption,
    shouldAlert: options.some((option) => option.alerted)
  };
}

function collectMarkets(searchPayload) {
  const collected = [];

  if (Array.isArray(searchPayload.markets)) {
    for (const market of searchPayload.markets) {
      collected.push({ market, event: null });
    }
  }

  if (Array.isArray(searchPayload.events)) {
    for (const event of searchPayload.events) {
      if (!Array.isArray(event.markets)) continue;
      for (const market of event.markets) {
        collected.push({ market, event });
      }
    }
  }

  return collected;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Polymarket returned ${response.status}: ${text.slice(0, 160)}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function searchGamma(dateInput, customQuery) {
  const queries = buildQueries(dateInput, customQuery);
  const results = [];

  for (const query of queries) {
    const url = new URL(`${GAMMA_API}/public-search`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit_per_type", "50");
    url.searchParams.set("events_status", "active");
    url.searchParams.set("keep_closed_markets", "0");
    url.searchParams.set("search_profiles", "false");
    url.searchParams.set("cache", "false");

    const payload = await fetchJson(url);
    results.push({ query, payload });
  }

  return results;
}

async function scanMarkets(params) {
  const dateInput = params.get("date") || toLocalDateInput();
  const threshold = Number(params.get("threshold") || "0.94");
  const customQuery = params.get("q") || "";
  const variants = dateVariants(dateInput);
  const queryResults = await searchGamma(dateInput, customQuery);
  const seen = new Set();
  const matches = [];

  for (const queryResult of queryResults) {
    for (const item of collectMarkets(queryResult.payload)) {
      const key = String(item.market.id || item.market.conditionId || item.market.slug || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const active = item.market.active !== false && item.market.closed !== true;
      if (!active) continue;
      if (!hasWeatherTemperatureSignal(item.market, item.event)) continue;
      if (!hasDateSignal(item.market, item.event, variants, dateInput)) continue;

      matches.push({
        ...normalizeMarket(item.market, item.event, threshold),
        matchedQuery: queryResult.query
      });
    }
  }

  matches.sort((a, b) => {
    if (a.shouldAlert !== b.shouldAlert) return a.shouldAlert ? -1 : 1;
    const aPrice = a.topOption && a.topOption.price != null ? a.topOption.price : -1;
    const bPrice = b.topOption && b.topOption.price != null ? b.topOption.price : -1;
    return bPrice - aPrice;
  });

  return {
    scannedAt: new Date().toISOString(),
    date: dateInput,
    threshold,
    queries: queryResults.map((item) => item.query),
    count: matches.length,
    alertCount: matches.filter((market) => market.shouldAlert).length,
    markets: matches
  };
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, "Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[ext] || "application/octet-stream";

    res.writeHead(200, { "content-type": type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (requestUrl.pathname === "/api/scan") {
      const payload = await scanMarkets(requestUrl.searchParams);
      sendJson(res, 200, payload);
      return;
    }

    if (requestUrl.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, now: new Date().toISOString() });
      return;
    }

    serveStatic(req, res, requestUrl.pathname);
  } catch (error) {
    sendJson(res, 500, {
      error: error && error.message ? error.message : "Unexpected server error"
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Polymarket weather detector running at http://${HOST}:${PORT}`);
});
