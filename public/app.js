const $ = (id) => document.getElementById(id);

const FTP = 250;

const ZONES = [
  { name: "RECOVERY",  pct: 0.55, color: "#969696" },
  { name: "ENDURANCE", pct: 0.75, color: "#4a90d9" },
  { name: "TEMPO",     pct: 0.90, color: "#2ecc71" },
  { name: "THRESHOLD", pct: 1.05, color: "#f1c40f" },
  { name: "VO2MAX",    pct: 1.20, color: "#e67e22" },
  { name: "ANAEROBIC", pct: 1.50, color: "#e74c3c" },
  { name: "NEUROMUSCULAR", pct: Infinity, color: "#8e44ad" },
];

function getZone(watts) {
  const pct = watts / FTP;
  for (let i = 0; i < ZONES.length; i++) {
    if (pct < ZONES[i].pct) return { idx: i, ...ZONES[i] };
  }
  return { idx: 6, ...ZONES[6] };
}

const powerHistory = [];
const MAX_HISTORY = 180;
let lastUpdate = 0;
let maxPowerSeen = 0;
let powerSum = 0;
let powerCount = 0;
let fourthPowerSum = 0;

const canvas = $("powerChart");
const ctx = canvas.getContext("2d");

let cW = 0, cH = 0;

function resizeCanvas() {
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w === 0 || h === 0) return;
  if (w === cW && h === cH) return;
  cW = w; cH = h;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawChart();
}

new ResizeObserver(resizeCanvas).observe(canvas.parentElement);
window.addEventListener("resize", resizeCanvas);
requestAnimationFrame(resizeCanvas);

function formatTime(seconds) {
  if (seconds == null) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function drawChart() {
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w === 0 || h === 0) return;
  const pad = { top: 8, right: 0, bottom: 0, left: 36 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  const ceiling = Math.max(FTP * 1.3, maxPowerSeen * 1.1, 100);

  // FTP reference line
  const ftpY = pad.top + plotH - (FTP / ceiling) * plotH;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(pad.left, ftpY);
  ctx.lineTo(w - pad.right, ftpY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#444";
  ctx.font = "9px monospace";
  ctx.textAlign = "right";
  ctx.fillText("FTP", pad.left - 6, ftpY + 3);

  // Y-axis grid
  const gridSteps = [100, 200, 300, 400, 500];
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  for (const step of gridSteps) {
    if (step >= ceiling) continue;
    const gy = pad.top + plotH - (step / ceiling) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
    ctx.fillStyle = "#333";
    ctx.fillText(step, pad.left - 6, gy + 3);
  }

  if (powerHistory.length < 2) return;

  // power bars
  const barW = Math.max(1, plotW / MAX_HISTORY - 0.5);
  for (let i = 0; i < powerHistory.length; i++) {
    const val = powerHistory[i];
    const zone = getZone(val);
    const barH = Math.max(1, (val / ceiling) * plotH);
    const x = pad.left + (i / MAX_HISTORY) * plotW;
    const y = pad.top + plotH - barH;

    ctx.fillStyle = zone.color + "50";
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = zone.color + "18";
    ctx.fillRect(x, pad.top, barW, plotH);
  }

  // smooth line on top
  ctx.beginPath();
  for (let i = 0; i < powerHistory.length; i++) {
    const x = pad.left + (i / MAX_HISTORY) * plotW + barW / 2;
    const y = pad.top + plotH - (powerHistory[i] / ceiling) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  const lastZone = getZone(powerHistory[powerHistory.length - 1]);
  ctx.strokeStyle = lastZone.color + "aa";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function updateUI(data) {
  const powerEl = $("power");
  const speedEl = $("speed");
  const cadenceEl = $("cadence");
  const hrEl = $("heartRate");

  if (data.power != null) {
    const w = Math.round(data.power);
    powerEl.textContent = w;

    const zone = getZone(w);
    powerEl.style.color = w > 0 ? zone.color : "";
    $("zoneFill").style.width = Math.min(100, (w / (FTP * 1.5)) * 100) + "%";
    $("zoneFill").style.background = zone.color;
    $("zoneLabel").textContent = w > 0 ? `Z${zone.idx + 1} · ${zone.name}` : "—";
    $("zoneLabel").style.color = w > 0 ? zone.color : "";

    powerHistory.push(w);
    if (powerHistory.length > MAX_HISTORY) powerHistory.shift();

    if (w > maxPowerSeen) maxPowerSeen = w;
    if (w > 0) {
      powerSum += w;
      powerCount++;
      fourthPowerSum += Math.pow(w, 4);
    }

    $("maxPower").textContent = maxPowerSeen || "—";

    if (powerCount > 0) {
      const np = Math.round(Math.pow(fourthPowerSum / powerCount, 0.25));
      $("np").textContent = np;
      const intensity = (np / FTP).toFixed(2);
      $("tss").textContent = intensity;
    }

    drawChart();
  }

  if (data.speed != null) {
    speedEl.textContent = (data.speed * 3.6).toFixed(1);
  }

  if (data.cadence != null) {
    cadenceEl.textContent = Math.round(data.cadence);
  }

  if (data.heartRate != null) {
    const hr = Math.round(data.heartRate);
    hrEl.textContent = hr;
    hrEl.style.color = "var(--hr-color)";
    const pct = Math.min(100, Math.max(0, ((hr - 60) / 140) * 100));
    $("hrBar").style.width = pct + "%";
  }

  if (data.distance != null) {
    $("distance").textContent = (data.distance / 1000).toFixed(2);
  }

  $("elapsed").textContent = formatTime(data.elapsedTime);

  if (data.averagePower != null) {
    $("avgPower").textContent = Math.round(data.averagePower);
  }

  if (data.calories != null) {
    $("calories").textContent = data.calories;
  }

  document.body.classList.remove("stale");
  lastUpdate = Date.now();
}

function updateStatus(data) {
  const el = $("status");
  const txt = $("status-text");
  el.className = "indicator " + data.status;
  if (data.status === "connected") {
    txt.textContent = "LIVE";
  } else if (data.status === "error") {
    txt.textContent = "ERROR";
  } else {
    txt.textContent = "NO SIGNAL";
  }
}

setInterval(() => {
  if (lastUpdate && Date.now() - lastUpdate > 5000) {
    document.body.classList.add("stale");
  }
}, 1000);

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "fitness") updateUI(data);
    else if (data.type === "status") updateStatus(data);
  };

  ws.onclose = () => {
    updateStatus({ status: "off", message: "" });
    setTimeout(connect, 2000);
  };

  ws.onerror = () => ws.close();
}

connect();
