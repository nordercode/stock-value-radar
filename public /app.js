const form = document.querySelector("#searchForm");
const input = document.querySelector("#tickerInput");
const resultPanel = document.querySelector("#resultPanel");
const emptyState = document.querySelector("#emptyState");
const stockExchange = document.querySelector("#stockExchange");
const stockName = document.querySelector("#stockName");
const stockPrice = document.querySelector("#stockPrice");
const stockChange = document.querySelector("#stockChange");
const logoWrap = document.querySelector("#logoWrap");
const logoFallback = document.querySelector("#logoFallback");
const profileFacts = document.querySelector("#profileFacts");
const priceChart = document.querySelector("#priceChart");
const verdictText = document.querySelector("#verdictText");
const scoreText = document.querySelector("#scoreText");
const scoreMarker = document.querySelector("#scoreMarker");
const scoreReasons = document.querySelector("#scoreReasons");
const metricsGrid = document.querySelector("#metricsGrid");
const toast = document.querySelector("#toast");
const suggestions = document.querySelector("#suggestions");
const rangeButtons = [...document.querySelectorAll("[data-range]")];

let activeTicker = "";
let activeRange = "12m";
let lastPayload = null;
let suggestTimer = null;
let suggestAbort = null;

const metricDefs = [
  ["pe", "KGV", "Gewinnvielfaches, niedriger ist meist günstiger", "Das Kurs-Gewinn-Verhältnis zeigt, wie viele Jahresgewinne Anleger für die Aktie bezahlen. Niedriger ist oft günstiger, aber nur bei stabilen Gewinnen."],
  ["forwardPe", "Forward KGV", "Erwartetes Gewinnvielfaches", "Das Forward-KGV nutzt erwartete Gewinne. Es ist hilfreich, wenn ein Unternehmen stark wächst oder sich gerade verändert."],
  ["peg", "PEG Ratio", "Bewertung relativ zum Wachstum", "PEG setzt Bewertung und Wachstum ins Verhältnis. Um 1 gilt oft als fair, deutlich darüber kann teuer wirken."],
  ["eps", "EPS", "Gewinn je Aktie", "EPS ist der Gewinn pro Aktie. Er hilft zu sehen, ob der Kurs durch echte Erträge getragen wird."],
  ["priceToBook", "Kurs/Buchwert", "Bilanznahe Bewertungsgröße", "Vergleicht den Börsenwert mit dem bilanziellen Eigenkapital. Besonders nützlich bei Banken, Versicherern und Substanzwerten."],
  ["profitMargin", "Nettomarge", "Profitabilität", "Die Nettomarge zeigt, wie viel vom Umsatz nach Kosten als Gewinn übrig bleibt. Höher bedeutet meist robusteres Geschäftsmodell."],
  ["revenueGrowth", "Umsatzwachstum", "Letztes gemeldetes Wachstum", "Zeigt, wie stark der Umsatz wächst. Wachstum ist wertvoller, wenn es profitabel und nachhaltig ist."],
  ["debtToEquity", "Debt/Equity", "Verschuldung relativ zum Eigenkapital", "Zeigt, wie stark ein Unternehmen über Schulden finanziert ist. Sehr hohe Werte erhöhen das Risiko."],
  ["shortFloat", "Short Float", "Leer verkaufter frei handelbarer Anteil", "Zeigt, welcher Anteil der frei handelbaren Aktien leerverkauft ist. Hohe Werte können Skepsis oder Squeeze-Risiko bedeuten."],
  ["beta", "Beta", "Schwankung relativ zum Markt", "Beta zeigt, wie stark die Aktie typischerweise im Vergleich zum Markt schwankt. Über 1 heißt meist volatiler."],
  ["dividendYield", "Dividendenrendite", "Ausschüttung relativ zum Kurs", "Zeigt die Dividende im Verhältnis zum Kurs. Eine hohe Rendite ist nur gut, wenn sie nachhaltig finanziert ist."],
  ["analystTarget", "Analysten-Kursziel", "Mittleres Kursziel in EUR", "Das mittlere Analystenziel ist eine Marktschätzung, keine Garantie. Es kann Hinweise auf erwartetes Potenzial geben."],
  ["analystUpside", "Potenzial zum Ziel", "Abstand zum mittleren Kursziel", "Zeigt, wie weit der aktuelle Kurs vom mittleren Analystenziel entfernt ist."],
  ["sma20", "SMA 20", "20 Tage Durchschnitt in EUR", "Der SMA 20 zeigt den kurzfristigen Durchschnittskurs. Er hilft, kurzfristiges Momentum einzuordnen."],
  ["dist20", "Abstand SMA 20", "Technischer Abstand", "Zeigt, wie weit der Kurs vom kurzfristigen Durchschnitt entfernt ist. Große Abstände können Übertreibung anzeigen."],
  ["sma50", "SMA 50", "50 Tage Durchschnitt in EUR", "Der SMA 50 glättet mittelfristige Kursschwankungen und zeigt den mittleren Trend."],
  ["dist50", "Abstand SMA 50", "Technischer Abstand", "Zeigt, ob der Kurs über oder unter dem mittelfristigen Trend liegt."],
  ["sma200", "SMA 200", "200 Tage Durchschnitt in EUR", "Der SMA 200 ist eine klassische langfristige Trendlinie. Oberhalb ist der Trend oft stärker, darunter vorsichtiger."],
  ["dist200", "Abstand SMA 200", "Technischer Abstand", "Zeigt den Abstand zum langfristigen Trend. Sehr weit darüber kann teuer, sehr weit darunter kann riskant oder günstig sein."],
  ["yearlyReturn", "Performance Zeitraum", "Kursveränderung im gewählten Chart", "Zeigt die Kursentwicklung im aktuell gewählten Chart-Zeitraum."],
  ["rangeHigh", "All-Time-High", "Höchster historischer Tageskurs", "Der höchste Tageskurs in der verfügbaren Historie. Der Abstand dazu zeigt, wie stark die Aktie korrigiert hat."],
  ["distHigh", "Abstand zum ATH", "Wie weit der Kurs unter dem All-Time-High liegt", "Ein großer Abstand kann Chance oder Warnsignal sein. Entscheidend ist, ob sich die Fundamentaldaten ebenfalls verschlechtert haben."],
  ["rangeLow", "Tief Zeitraum", "Niedrigster Kurs im gewählten Chart", "Der tiefste Kurs im sichtbaren Chart-Zeitraum."],
  ["distLow", "Abstand zum Tief", "Wie weit der Kurs über dem Tief liegt", "Zeigt, wie stark sich die Aktie vom jüngsten Tief erholt hat."],
  ["annualVolatility", "Volatilität", "Annualisierte Schwankung aus Kursdaten", "Volatilität zeigt, wie stark der Kurs schwankt. Höhere Volatilität bedeutet größere Chancen, aber auch mehr Risiko."],
  ["maxDrawdown", "Max. Drawdown", "Größter Rückgang vom Zwischenhoch", "Der maximale Rückgang vom Zwischenhoch zeigt, wie schmerzhaft eine Schwächephase zuletzt war."],
  ["rsi14", "RSI 14", "Kurzfristiger Momentumindikator", "RSI misst kurzfristiges Momentum. Unter 30 gilt oft als überverkauft, über 70 als überkauft."]
];

function hasUsableValue(value) {
  return Number.isFinite(value) && Math.abs(value) > 0.000001;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 3600);
}

function money(value) {
  if (!Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2
  }).format(value);
}

function compact(value) {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("de-DE", {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(value);
}

function number(value, digits = 2) {
  if (!Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: digits
  }).format(value);
}

function percent(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${number(value, 2)}%`;
}

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function metricValue(key, value) {
  if (["profitMargin", "revenueGrowth", "shortFloat", "dividendYield", "analystUpside", "dist20", "dist50", "dist200", "yearlyReturn", "distHigh", "distLow", "annualVolatility", "maxDrawdown"].includes(key)) {
    return percent(value);
  }
  if (["analystTarget", "sma20", "sma50", "sma200", "eps", "rangeHigh", "rangeLow"].includes(key)) {
    return money(value);
  }
  return number(value);
}

function drawChart(points) {
  const ctx = priceChart.getContext("2d");
  const width = priceChart.width;
  const height = priceChart.height;
  const pad = { top: 44, right: 22, bottom: 34, left: 88 };
  ctx.clearRect(0, 0, width, height);

  if (!points.length) {
    ctx.fillStyle = "#67707d";
    ctx.font = "28px system-ui";
    ctx.fillText("Keine Chartdaten", 42, height / 2);
    return;
  }

  const values = points.map((point) => point.close);
  const smaValues = points.map((point) => point.sma200).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values, ...smaValues);
  const floor = Math.min(min, ...smaValues);
  const span = max - floor || 1;
  const up = values.at(-1) >= values[0];
  const lineColor = up ? "#179b5f" : "#c63b3f";

  const x = (index) => pad.left + (index / Math.max(1, points.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value - floor) / span) * (height - pad.top - pad.bottom);

  ctx.strokeStyle = "#263241";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#67707d";
  ctx.font = "20px system-ui";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 3; i += 1) {
    const value = floor + (span * i) / 3;
    const yy = y(value);
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(width - pad.right, yy);
    ctx.stroke();
    ctx.fillText(money(value), pad.left - 10, yy);
  }

  const pricePath = () => {
    ctx.beginPath();
    points.forEach((point, index) => {
      const xx = x(index);
      const yy = y(point.close);
      if (index === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
  };

  pricePath();
  ctx.lineTo(width - pad.right, height - pad.bottom);
  ctx.lineTo(pad.left, height - pad.bottom);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  gradient.addColorStop(0, up ? "rgba(67,215,135,0.22)" : "rgba(239,94,104,0.2)");
  gradient.addColorStop(1, "rgba(8,12,18,0)");
  ctx.fillStyle = gradient;
  ctx.fill();

  pricePath();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  const smaPoints = points.filter((point) => Number.isFinite(point.sma200));
  if (smaPoints.length > 1) {
    ctx.beginPath();
    smaPoints.forEach((point, index) => {
      const originalIndex = points.indexOf(point);
      const xx = x(originalIndex);
      const yy = y(point.sma200);
      if (index === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
    ctx.strokeStyle = "#6aa8ff";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (smaPoints.length > 1) {
    ctx.fillStyle = "#6aa8ff";
    ctx.font = "bold 18px system-ui";
    ctx.fillText("SMA 200", width - 104, 16);
  }
}

function renderMetrics(metrics) {
  const cards = metricDefs
    .filter(([key]) => hasUsableValue(metrics[key]))
    .map(([key, label, hint, explanation]) => {
      const value = metrics[key];
      return `
        <article tabindex="0" role="button" aria-label="${label} erklären">
          <div class="metric-card">
            <div class="metric-face metric-front">
              <b class="metric-info">i</b>
              <span>${label}</span>
              <strong>${metricValue(key, value)}</strong>
              <small>${hint}</small>
            </div>
            <div class="metric-face metric-back">
              <span>${label}</span>
              <small>${explanation}</small>
            </div>
          </div>
        </article>
      `;
    });

  metricsGrid.innerHTML = cards.length
    ? cards.join("")
    : `<p class="metrics-empty">Für diesen Titel sind aktuell keine belastbaren Kennzahlen verfügbar.</p>`;
}

function renderLogo(payload) {
  logoWrap.innerHTML = "";
  logoFallback.textContent = "";
  const fallback = document.createElement("span");
  fallback.textContent = initials(payload.name);
  const img = document.createElement("img");
  img.alt = "";
  img.src = payload.profile?.logo || "";
  img.addEventListener("error", () => {
    logoWrap.innerHTML = "";
    logoWrap.append(fallback);
  }, { once: true });
  logoWrap.append(img);
}

function renderProfileFacts(profile) {
  const facts = [];
  if (profile?.exchange) facts.push(profile.exchange);
  if (Number.isFinite(profile?.marketCap)) facts.push(`Market Cap ${compact(profile.marketCap)} €`);
  if (Number.isFinite(profile?.employees)) facts.push(`${compact(profile.employees)} Mitarbeiter`);
  if (profile?.sector) facts.push(profile.sector);
  profileFacts.innerHTML = facts.map((fact) => `<span>${fact}</span>`).join("");
}

function render(payload) {
  lastPayload = payload;
  emptyState.classList.add("is-hidden");
  resultPanel.classList.remove("is-hidden");
  stockExchange.textContent = `${payload.symbol}${payload.exchange ? ` · ${payload.exchange}` : ""}`;
  stockName.textContent = payload.name;
  stockPrice.textContent = money(payload.price);
  stockChange.textContent = Number.isFinite(payload.changePercent) ? percent(payload.changePercent) : "";
  stockChange.className = Number.isFinite(payload.changePercent) && payload.changePercent >= 0 ? "up" : "down";
  renderLogo(payload);
  renderProfileFacts(payload.profile);
  verdictText.textContent = payload.verdict;
  scoreText.textContent = `${payload.score}/100`;
  scoreMarker.style.left = `${payload.score}%`;
  scoreReasons.innerHTML = (payload.rationale || []).map((reason) => `<p>${reason}</p>`).join("");
  renderMetrics(payload.metrics);
  drawChart(payload.chart);
}

async function loadStock(ticker, range = activeRange) {
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "Lädt...";

  try {
    const response = await fetch(`/api/stock?q=${encodeURIComponent(ticker)}&range=${encodeURIComponent(range)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Keine Daten gefunden.");
    activeTicker = ticker;
    activeRange = range;
    render(payload);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Suchen";
  }
}

async function loadSuggestions(value) {
  const query = value.trim();
  if (query.length < 2) {
    suggestions.classList.remove("is-open");
    suggestions.innerHTML = "";
    return;
  }

  if (suggestAbort) suggestAbort.abort();
  suggestAbort = new AbortController();

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: suggestAbort.signal });
    const payload = await response.json();
    const results = payload.results || [];
    suggestions.innerHTML = results.map((item) => `
      <button type="button" data-symbol="${item.symbol}">
        <strong>${item.name}</strong>
        <span>${item.symbol}${item.exchange ? ` · ${item.exchange}` : ""}</span>
      </button>
    `).join("");
    suggestions.classList.toggle("is-open", results.length > 0);
  } catch (error) {
    if (error.name !== "AbortError") suggestions.classList.remove("is-open");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const ticker = input.value.trim();
  suggestions.classList.remove("is-open");
  if (ticker) loadStock(ticker, activeRange);
});

input.addEventListener("input", () => {
  window.clearTimeout(suggestTimer);
  suggestTimer = window.setTimeout(() => loadSuggestions(input.value), 180);
});

suggestions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-symbol]");
  if (!button) return;
  input.value = button.dataset.symbol;
  suggestions.classList.remove("is-open");
  loadStock(button.dataset.symbol, activeRange);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".suggest-box")) suggestions.classList.remove("is-open");
});

metricsGrid.addEventListener("click", (event) => {
  const card = event.target.closest("article");
  if (card) card.classList.toggle("is-flipped");
});

metricsGrid.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const card = event.target.closest("article");
  if (!card) return;
  event.preventDefault();
  card.classList.toggle("is-flipped");
});

rangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    rangeButtons.forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    const range = button.dataset.range;
    activeRange = range;
    if (activeTicker) loadStock(activeTicker, range);
    if (lastPayload) drawChart(lastPayload.chart);
  });
});

const initialQuery = new URLSearchParams(window.location.search).get("q");
if (initialQuery) {
  input.value = initialQuery;
  loadStock(initialQuery, activeRange);
}
