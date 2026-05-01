const state = {
  lastPayload: null
};

const els = {
  marketType: document.querySelector("#marketType"),
  scanDate: document.querySelector("#scanDate"),
  threshold: document.querySelector("#threshold"),
  minCents: document.querySelector("#minCents"),
  maxCents: document.querySelector("#maxCents"),
  query: document.querySelector("#query"),
  scanNow: document.querySelector("#scanNow"),
  runState: document.querySelector("#runState"),
  marketCount: document.querySelector("#marketCount"),
  alertCount: document.querySelector("#alertCount"),
  rangeSummary: document.querySelector("#rangeSummary"),
  lastScan: document.querySelector("#lastScan"),
  querySummary: document.querySelector("#querySummary"),
  resultsList: document.querySelector("#resultsList")
};

function todayInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function thresholdDecimal() {
  const cents = Number(els.threshold.value || 94);
  return Math.max(0.01, Math.min(0.99, cents / 100));
}

function centsBounds() {
  const first = Math.max(0, Math.min(100, Number(els.minCents.value || 0)));
  const second = Math.max(0, Math.min(100, Number(els.maxCents.value || 100)));
  return {
    minCents: Math.min(first, second),
    maxCents: Math.max(first, second)
  };
}

function scanUrl() {
  const params = new URLSearchParams();
  const bounds = centsBounds();
  params.set("marketType", els.marketType.value || "weather");
  params.set("date", els.scanDate.value || todayInput());
  params.set("threshold", String(thresholdDecimal()));
  params.set("minCents", String(bounds.minCents));
  params.set("maxCents", String(bounds.maxCents));
  if (els.query.value.trim()) params.set("q", els.query.value.trim());
  return `/api/scan?${params.toString()}`;
}

function formatTime(value) {
  if (!value) return "Never";
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDate(value) {
  if (!value) return "No end date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No end date";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function priceLabel(option) {
  if (option.priceCents == null) return "No price";
  return `${option.priceCents.toFixed(option.priceCents % 1 ? 2 : 0)}c`;
}

function rangeLabel(range) {
  if (!range) return "0-100c";
  return `${Number(range.minCents).toFixed(Number(range.minCents) % 1 ? 2 : 0)}-${Number(range.maxCents).toFixed(Number(range.maxCents) % 1 ? 2 : 0)}c`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarket(market) {
  const options = market.options
    .map((option) => {
      const classes = ["option"];
      if (option.inRange) classes.push("in-range");
      if (option.alerted) classes.push("hit");
      const cls = classes.join(" ");
      return `<span class="${cls}">${escapeHtml(option.outcome)} ${escapeHtml(priceLabel(option))}</span>`;
    })
    .join("");

  const meta = [
    market.eventTitle,
    `Ends ${formatDate(market.endDate)}`,
    market.enableOrderBook ? "Order book enabled" : "Gamma price only",
    market.acceptingOrders ? "Accepting orders" : "Orders not accepting"
  ].filter(Boolean);

  return `
    <article class="market ${market.shouldAlert ? "alert" : ""}">
      <div>
        <div class="market-title">${escapeHtml(market.question)}</div>
        <div class="market-meta">
          ${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        </div>
        <div class="option-row">${options || '<span class="muted">No options returned</span>'}</div>
      </div>
      <div class="market-actions">
        <a class="open-link" href="${escapeHtml(market.url)}" target="_blank" rel="noreferrer">Open market</a>
      </div>
    </article>
  `;
}

function render(payload) {
  state.lastPayload = payload;
  els.marketCount.textContent = String(payload.count);
  els.alertCount.textContent = String(payload.alertCount);
  els.rangeSummary.textContent = rangeLabel(payload.centsRange);
  els.lastScan.textContent = formatTime(payload.scannedAt);
  els.querySummary.textContent = `${payload.marketTypeLabel || "Markets"}: ${payload.queries.join(" | ")}`;

  if (!payload.markets.length) {
    els.resultsList.className = "market-list empty";
    els.resultsList.innerHTML = "<p>No matching open markets were found for this section, query, and cents range.</p>";
    return;
  }

  els.resultsList.className = "market-list";
  els.resultsList.innerHTML = payload.markets.map(renderMarket).join("");
}

async function scan() {
  els.scanNow.disabled = true;
  els.runState.textContent = "Scanning";

  try {
    const response = await fetch(scanUrl(), { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Scan failed");
    render(payload);
  } catch (error) {
    els.resultsList.className = "market-list empty";
    els.resultsList.innerHTML = `<p>${escapeHtml(error.message || "Scan failed")}</p>`;
  } finally {
    els.scanNow.disabled = false;
    els.runState.textContent = "Idle";
  }
}

els.scanDate.value = todayInput();
els.scanNow.addEventListener("click", scan);
els.query.addEventListener("keydown", (event) => {
  if (event.key === "Enter") scan();
});
