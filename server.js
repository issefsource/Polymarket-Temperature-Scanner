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

const MARKET_TYPES = {
  weather: {
    label: "Weather",
    terms: ["temperature", "temp", "degrees", "fahrenheit", "highest temperature", "high temperature"]
  },
  politics: {
    label: "Politics",
    terms: [
      "politics",
      "election",
      "president",
      "presidential",
      "senate",
      "congress",
      "governor",
      "mayor",
      "republican",
      "democrat",
      "government"
    ]
  },
  sports: {
    label: "Sports",
    terms: ["sports", "nba", "nfl", "mlb", "nhl", "soccer", "football", "champions league", "world cup"]
  },
  crypto: {
    label: "Crypto",
    terms: ["crypto", "bitcoin", "btc", "ethereum", "eth", "solana", "sol", "xrp"]
  },
  all: {
    label: "All",
    terms: []
  }
};

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

function parseDateQuery(input, fallbackYear) {
  const text = normalizeText(input);
  const monthIndex = MONTHS.findIndex(([full, short]) => {
    return new RegExp(`\\b(${full}|${short})\\b`).test(text);
  });
  if (monthIndex === -1) return null;

  const dayMatch = text.match(/\b([1-9]|[12]\d|3[01])\b/);
  if (!dayMatch) return null;

  const day = Number(dayMatch[1]);
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : fallbackYear;
  const month = monthIndex + 1;

  return {
    year,
    month,
    day,
    dateInput: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  };
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

function uniqueList(items) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function buildQueries(dateInput, customQuery, marketType) {
  const typeConfig = MARKET_TYPES[marketType] || MARKET_TYPES.weather;
  if (customQuery && customQuery.trim()) {
    const query = customQuery.trim();
    if (marketType === "all") return [query];

    const prefixes = marketType === "weather"
      ? ["weather", "temperature", "highest temperature"]
      : typeConfig.terms.slice(0, 3);

    return uniqueList([
      ...prefixes.map((prefix) => `${prefix} ${query}`),
      query
    ]);
  }

  const { month, day, year } = parseDateInput(dateInput);
  const [fullMonth, shortMonth] = MONTHS[month - 1];
  const monthDay = `${fullMonth} ${day}`;
  const shortMonthDay = `${shortMonth} ${day}`;

  if (marketType === "all") {
    return [monthDay, shortMonthDay, `${monthDay} ${year}`];
  }

  if (marketType !== "weather") {
    return uniqueList([
      ...typeConfig.terms.slice(0, 4),
      ...typeConfig.terms.slice(0, 2).map((term) => `${term} ${monthDay}`)
    ]);
  }

  return [
    `temperature ${monthDay}`,
    `highest temperature ${monthDay}`,
    `weather temperature ${monthDay}`,
    `temperature ${shortMonthDay}`,
    `highest temperature ${monthDay} ${year}`
  ];
}

function marketHaystack(market, sourceEvent) {
  return normalizeText([
    market.question,
    market.title,
    market.groupItemTitle,
    market.description,
    market.category,
    market.slug,
    sourceEvent && sourceEvent.title,
    sourceEvent && sourceEvent.description,
    sourceEvent && sourceEvent.category,
    sourceEvent && sourceEvent.slug
  ].join(" "));
}

function matchesMarketType(market, sourceEvent, marketType) {
  if (marketType === "all") return true;
  const typeConfig = MARKET_TYPES[marketType] || MARKET_TYPES.weather;
  const haystack = marketHaystack(market, sourceEvent);
  return typeConfig.terms.some((term) => haystack.includes(term));
}

function datePart(value) {
  if (!value) return "";
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function titleHasDateSignal(market, sourceEvent, variants) {
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

function hasDateSignal(market, sourceEvent, variants, dateInput) {
  const marketEndDate = datePart(market.endDateIso || market.endDate);
  if (marketEndDate) return marketEndDate === dateInput;

  return titleHasDateSignal(market, sourceEvent, variants);
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

function clampCents(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
}

function centsRangeFromParams(params) {
  const first = clampCents(params.get("minCents"), 0);
  const second = clampCents(params.get("maxCents"), 100);
  const minCents = Math.min(first, second);
  const maxCents = Math.max(first, second);

  return {
    minCents,
    maxCents
  };
}

function normalizeMarket(market, sourceEvent, threshold, centsRange) {
  const event = bestEvent(market, sourceEvent);
  const outcomes = parseMaybeJson(market.outcomes);
  const prices = parseMaybeJson(market.outcomePrices);
  const tokenIds = parseMaybeJson(market.clobTokenIds);

  const options = outcomes.map((outcome, index) => {
    const price = Number(prices[index]);
    const priceCents = Number.isFinite(price) ? Math.round(price * 10000) / 100 : null;
    return {
      outcome: String(outcome),
      price: Number.isFinite(price) ? price : null,
      priceCents,
      tokenId: tokenIds[index] ? String(tokenIds[index]) : null,
      alerted: Number.isFinite(price) && price >= threshold,
      inRange: priceCents != null && priceCents >= centsRange.minCents && priceCents <= centsRange.maxCents
    };
  });

  const topOption = options.reduce((best, option) => {
    if (option.price == null) return best;
    if (!best || option.price > best.price) return option;
    return best;
  }, null);

  const topRangeOption = options.reduce((best, option) => {
    if (!option.inRange || option.price == null) return best;
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
    topRangeOption,
    hasPriceInRange: options.some((option) => option.inRange),
    shouldAlert: options.some((option) => option.alerted && option.inRange)
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

async function searchGamma(dateInput, customQuery, marketType) {
  const queries = buildQueries(dateInput, customQuery, marketType);
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
  const centsRange = centsRangeFromParams(params);
  const customQuery = params.get("q") || "";
  const requestedType = normalizeText(params.get("marketType") || "weather");
  const marketType = MARKET_TYPES[requestedType] ? requestedType : "weather";
  const hasCustomQuery = Boolean(customQuery.trim());
  const selectedDate = parseDateInput(dateInput);
  const queryDate = hasCustomQuery ? parseDateQuery(customQuery, selectedDate.year) : null;
  const filterDateInput = queryDate ? queryDate.dateInput : dateInput;
  const variants = dateVariants(filterDateInput);
  const queryResults = await searchGamma(dateInput, customQuery, marketType);
  const seen = new Set();
  const matches = [];

  for (const queryResult of queryResults) {
    for (const item of collectMarkets(queryResult.payload)) {
      const key = String(item.market.id || item.market.conditionId || item.market.slug || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const active = item.market.active !== false && item.market.closed !== true;
      if (!active) continue;
      if (!matchesMarketType(item.market, item.event, marketType)) continue;
      if (queryDate && !hasDateSignal(item.market, item.event, variants, filterDateInput)) continue;
      if (marketType === "weather" && !hasCustomQuery && !hasDateSignal(item.market, item.event, variants, filterDateInput)) continue;

      const normalized = normalizeMarket(item.market, item.event, threshold, centsRange);
      if (!normalized.hasPriceInRange) continue;

      matches.push({
        ...normalized,
        matchedQuery: queryResult.query
      });
    }
  }

  matches.sort((a, b) => {
    if (a.shouldAlert !== b.shouldAlert) return a.shouldAlert ? -1 : 1;
    const aRangePrice = a.topRangeOption && a.topRangeOption.price != null ? a.topRangeOption.price : -1;
    const bRangePrice = b.topRangeOption && b.topRangeOption.price != null ? b.topRangeOption.price : -1;
    if (aRangePrice !== bRangePrice) return bRangePrice - aRangePrice;
    const aPrice = a.topOption && a.topOption.price != null ? a.topOption.price : -1;
    const bPrice = b.topOption && b.topOption.price != null ? b.topOption.price : -1;
    return bPrice - aPrice;
  });

  return {
    scannedAt: new Date().toISOString(),
    date: dateInput,
    marketType,
    marketTypeLabel: MARKET_TYPES[marketType].label,
    customQuery: customQuery.trim(),
    threshold,
    centsRange: {
      minCents: centsRange.minCents,
      maxCents: centsRange.maxCents
    },
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
