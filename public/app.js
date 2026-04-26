const state = {
  timer: null,
  running: false,
  notified: new Set(),
  lastPayload: null
};

const els = {
  scanDate: document.querySelector("#scanDate"),
  threshold: document.querySelector("#threshold"),
  intervalSeconds: document.querySelector("#intervalSeconds"),
  query: document.querySelector("#query"),
  scanNow: document.querySelector("#scanNow"),
  startWatch: document.querySelector("#startWatch"),
  stopWatch: document.querySelector("#stopWatch"),
  notifyPermission: document.querySelector("#notifyPermission"),
  runState: document.querySelector("#runState"),
  marketCount: document.querySelector("#marketCount"),
  alertCount: document.querySelector("#alertCount"),
  lastScan: document.querySelector("#lastScan"),
  querySummary: document.querySelector("#querySummary"),
  resultsList: document.querySelector("#resultsList"),
  alertLog: document.querySelector("#alertLog"),
  clearAlerts: document.querySelector("#clearAlerts")
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

function scanUrl() {
  const params = new URLSearchParams();
  params.set("date", els.scanDate.value || todayInput());
  params.set("threshold", String(thresholdDecimal()));
  if (els.query.value.trim()) params.set("q", els.query.value.trim());
  return `/api/scan?${params.toString()}`;
}

function setRunning(running) {
  state.running = running;
  els.startWatch.disabled = running;
  els.stopWatch.disabled = !running;
  els.runState.textContent = running ? "Watching" : "Idle";
  els.runState.classList.toggle("running", running);
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function playAlertTone() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.48);
}

function browserNotify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(title, { body, tag: title + body });
}

function addAlert(market, option) {
  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const li = document.createElement("li");
  li.innerHTML = `<strong>${escapeHtml(time)}</strong> Execute trade: ${escapeHtml(option.outcome)} reached ${escapeHtml(priceLabel(option))} in ${escapeHtml(market.question)}.`;
  els.alertLog.prepend(li);
}

function handleAlerts(payload) {
  for (const market of payload.markets) {
    for (const option of market.options) {
      if (!option.alerted) continue;
      const key = `${payload.date}:${market.id}:${option.outcome}`;
      if (state.notified.has(key)) continue;
      state.notified.add(key);

      const title = "Polymarket threshold hit";
      const body = `${option.outcome} is ${priceLabel(option)}: ${market.question}`;
      addAlert(market, option);
      browserNotify(title, body);
      playAlertTone();
    }
  }
}

function renderMarket(market) {
  const options = market.options
    .map((option) => {
      const cls = option.alerted ? "option hit" : "option";
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
  els.lastScan.textContent = formatTime(payload.scannedAt);
  els.querySummary.textContent = payload.queries.join(" | ");

  if (!payload.markets.length) {
    els.resultsList.className = "market-list empty";
    els.resultsList.innerHTML = "<p>No matching open temperature markets were found for this scan date.</p>";
    return;
  }

  els.resultsList.className = "market-list";
  els.resultsList.innerHTML = payload.markets.map(renderMarket).join("");
}

async function scan() {
  els.scanNow.disabled = true;
  els.runState.textContent = state.running ? "Scanning" : "Scanning";

  try {
    const response = await fetch(scanUrl(), { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Scan failed");
    render(payload);
    handleAlerts(payload);
  } catch (error) {
    els.resultsList.className = "market-list empty";
    els.resultsList.innerHTML = `<p>${escapeHtml(error.message || "Scan failed")}</p>`;
  } finally {
    els.scanNow.disabled = false;
    els.runState.textContent = state.running ? "Watching" : "Idle";
  }
}

function startWatch() {
  const seconds = Math.max(10, Number(els.intervalSeconds.value || 60));
  stopWatch();
  setRunning(true);
  scan();
  state.timer = window.setInterval(scan, seconds * 1000);
}

function stopWatch() {
  if (state.timer) window.clearInterval(state.timer);
  state.timer = null;
  setRunning(false);
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    addAlert({ question: "Browser notifications are unavailable here" }, { outcome: "Notice", priceCents: null });
    return;
  }
  await Notification.requestPermission();
  if (Notification.permission === "granted") {
    browserNotify("Alerts enabled", "You will be notified when a weather option reaches your threshold.");
  }
}

els.scanDate.value = todayInput();
els.scanNow.addEventListener("click", scan);
els.startWatch.addEventListener("click", startWatch);
els.stopWatch.addEventListener("click", stopWatch);
els.notifyPermission.addEventListener("click", requestNotifications);
els.clearAlerts.addEventListener("click", () => {
  els.alertLog.innerHTML = "";
  state.notified.clear();
});
