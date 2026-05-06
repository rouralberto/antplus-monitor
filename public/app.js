const $ = (id) => document.getElementById(id);

const FTP = 250;

const ZONES = [
  { name: "RECOVERY",  pct: 0.55, color: "#b0b0b0" },
  { name: "ENDURANCE", pct: 0.75, color: "#5ab0ff" },
  { name: "TEMPO",     pct: 0.90, color: "#40e882" },
  { name: "THRESHOLD", pct: 1.05, color: "#ffd740" },
  { name: "VO2MAX",    pct: 1.20, color: "#ff9940" },
  { name: "ANAEROBIC", pct: 1.50, color: "#ff4d4d" },
  { name: "NEUROMUSCULAR", pct: Infinity, color: "#c060ff" },
];

function getZone(watts) {
  const pct = watts / FTP;
  for (let i = 0; i < ZONES.length; i++) {
    if (pct < ZONES[i].pct) return { idx: i, ...ZONES[i] };
  }
  return { idx: 6, ...ZONES[6] };
}

let exerciseData = [];
let lastUpdate = 0;
let maxPowerSeen = 0;
let powerSum = 0;
let powerCount = 0;
let fourthPowerSum = 0;
let accumulatedDistance = 0;
let sessionElapsed = 0;

// Auto-reset: track consecutive zero-power seconds
const ZERO_POWER_RESET_MS = 120_000;
const COUNTDOWN_START_MS = 30_000;
let zeroPowerSince = null;
let countdownInterval = null;

let ws = null;

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

  const ftpY = pad.top + plotH - (FTP / ceiling) * plotH;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(pad.left, ftpY);
  ctx.lineTo(w - pad.right, ftpY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#666";
  ctx.font = "9px monospace";
  ctx.textAlign = "right";
  ctx.fillText("FTP", pad.left - 6, ftpY + 3);

  const gridSteps = [100, 200, 300, 400, 500];
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  for (const step of gridSteps) {
    if (step >= ceiling) continue;
    const gy = pad.top + plotH - (step / ceiling) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
    ctx.fillStyle = "#555";
    ctx.fillText(step, pad.left - 6, gy + 3);
  }

  const len = exerciseData.length;
  if (len < 2) return;

  const barW = Math.max(1, plotW / len - 0.5);

  for (let i = 0; i < len; i++) {
    const val = exerciseData[i].power;
    const zone = getZone(val);
    const barH = Math.max(1, (val / ceiling) * plotH);
    const x = pad.left + (i / len) * plotW;
    const y = pad.top + plotH - barH;

    ctx.fillStyle = zone.color + "70";
    ctx.fillRect(x, y, barW, barH);
  }

  ctx.beginPath();
  for (let i = 0; i < len; i++) {
    const x = pad.left + (i / len) * plotW + barW / 2;
    const y = pad.top + plotH - (exerciseData[i].power / ceiling) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  const lastZone = getZone(exerciseData[len - 1].power);
  ctx.strokeStyle = lastZone.color + "cc";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (len > 10) {
    const totalSec = (exerciseData[len - 1].ts - exerciseData[0].ts) / 1000;
    const labelCount = Math.min(6, Math.floor(totalSec / 60));
    if (labelCount > 0) {
      ctx.fillStyle = "#555";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      for (let i = 1; i <= labelCount; i++) {
        const secMark = (totalSec / (labelCount + 1)) * i;
        const xPct = secMark / totalSec;
        const x = pad.left + xPct * plotW;
        ctx.fillText(formatTime(secMark), x, h - 2);
      }
    }
  }
}

function resetExercise() {
  // Tell server to reset its session
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "resetSession" }));
  }
  applyReset();
}

function applyReset() {
  exerciseData = [];
  maxPowerSeen = 0;
  powerSum = 0;
  powerCount = 0;
  fourthPowerSum = 0;
  accumulatedDistance = 0;
  sessionElapsed = 0;
  zeroPowerSince = null;
  hideCountdown();

  $("power").textContent = "—";
  $("power").style.color = "";
  $("speed").textContent = "—";
  $("cadence").textContent = "—";
  $("heartRate").textContent = "—";
  $("heartRate").style.color = "";
  $("elapsed").textContent = "00:00";
  $("avgPower").textContent = "—";
  $("maxPower").textContent = "—";
  $("distance").textContent = "—";
  $("distUnit").textContent = "km";
  $("calories").textContent = "—";
  $("np").textContent = "—";
  $("tss").textContent = "—";
  $("zoneFill").style.width = "0%";
  $("zoneLabel").textContent = "—";
  $("zoneLabel").style.color = "";
  $("hrBar").style.width = "0%";

  drawChart();
}

function restoreSession(data) {
  exerciseData = data.exerciseData || [];
  maxPowerSeen = data.maxPowerSeen || 0;
  powerSum = data.powerSum || 0;
  powerCount = data.powerCount || 0;
  fourthPowerSum = data.fourthPowerSum || 0;
  accumulatedDistance = data.accumulatedDistance || 0;

  if (data.startedAt) {
    sessionElapsed = (Date.now() - data.startedAt) / 1000;
  }

  // Rebuild UI from restored state
  $("elapsed").textContent = formatTime(sessionElapsed);
  $("maxPower").textContent = maxPowerSeen || "—";

  if (powerCount > 0) {
    $("avgPower").textContent = Math.round(powerSum / powerCount);
    const np = Math.round(Math.pow(fourthPowerSum / powerCount, 0.25));
    $("np").textContent = np;
    $("tss").textContent = (np / FTP).toFixed(2);
  }

  const distMeters = accumulatedDistance;
  if (distMeters >= 1000) {
    $("distance").textContent = (distMeters / 1000).toFixed(2);
    $("distUnit").textContent = "km";
  } else if (distMeters > 0) {
    $("distance").textContent = Math.round(distMeters);
    $("distUnit").textContent = "m";
  }

  if (exerciseData.length > 0) {
    const last = exerciseData[exerciseData.length - 1];
    if (last.power > 0) {
      const zone = getZone(last.power);
      $("power").textContent = last.power;
      $("power").style.color = zone.color;
      $("zoneFill").style.width = Math.min(100, (last.power / (FTP * 1.5)) * 100) + "%";
      $("zoneFill").style.background = zone.color;
      $("zoneLabel").textContent = `Z${zone.idx + 1} · ${zone.name}`;
      $("zoneLabel").style.color = zone.color;
    }
    if (last.speed != null) {
      $("speed").textContent = (last.speed * 3.6).toFixed(1);
    }
    if (last.cadence != null) {
      $("cadence").textContent = Math.round(last.cadence);
    }
    if (last.hr != null) {
      $("heartRate").textContent = Math.round(last.hr);
      $("heartRate").style.color = "var(--hr-color)";
    }
    if (last.calories != null) {
      $("calories").textContent = last.calories;
    }
  }

  drawChart();
}

function showCountdown(remainingMs) {
  const el = $("countdown");
  const secs = Math.ceil(remainingMs / 1000);
  el.textContent = `RESETTING IN ${secs}s`;
  el.classList.add("visible");
}

function hideCountdown() {
  $("countdown").classList.remove("visible");
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function handleZeroPowerReset(power, now) {
  if (power > 0) {
    zeroPowerSince = null;
    hideCountdown();
    return;
  }

  if (exerciseData.length === 0) return;

  if (zeroPowerSince === null) {
    zeroPowerSince = now;
  }

  const elapsed = now - zeroPowerSince;

  if (elapsed >= ZERO_POWER_RESET_MS) {
    resetExercise();
    return;
  }

  const remaining = ZERO_POWER_RESET_MS - elapsed;
  if (remaining <= COUNTDOWN_START_MS) {
    showCountdown(remaining);
    if (!countdownInterval) {
      countdownInterval = setInterval(() => {
        if (zeroPowerSince === null) { hideCountdown(); return; }
        const r = ZERO_POWER_RESET_MS - (Date.now() - zeroPowerSince);
        if (r <= 0) {
          resetExercise();
        } else {
          showCountdown(r);
        }
      }, 500);
    }
  }
}

function exportExercise() {
  if (exerciseData.length === 0) return;

  const rows = ["timestamp,elapsed_s,power_w,speed_ms,cadence_rpm,heart_rate_bpm,distance_m,calories"];
  const t0 = exerciseData[0].ts;
  for (const d of exerciseData) {
    rows.push([
      new Date(d.ts).toISOString(),
      ((d.ts - t0) / 1000).toFixed(1),
      d.power ?? "",
      d.speed != null ? d.speed.toFixed(3) : "",
      d.cadence ?? "",
      d.hr ?? "",
      d.distance ?? "",
      d.calories ?? "",
    ].join(","));
  }

  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
  a.href = url;
  a.download = `velolab_${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

$("exportBtn").addEventListener("click", exportExercise);

function updateUI(data) {
  const now = Date.now();
  const powerEl = $("power");
  const speedEl = $("speed");
  const cadenceEl = $("cadence");
  const hrEl = $("heartRate");

  const w = data.power != null ? Math.round(data.power) : 0;

  handleZeroPowerReset(w, now);

  if (data.power != null) {
    powerEl.textContent = w;

    const zone = getZone(w);
    powerEl.style.color = w > 0 ? zone.color : "";
    $("zoneFill").style.width = Math.min(100, (w / (FTP * 1.5)) * 100) + "%";
    $("zoneFill").style.background = zone.color;
    $("zoneLabel").textContent = w > 0 ? `Z${zone.idx + 1} · ${zone.name}` : "—";
    $("zoneLabel").style.color = w > 0 ? zone.color : "";

    exerciseData.push({
      ts: now,
      power: w,
      speed: data.speed,
      cadence: data.cadence,
      hr: data.heartRate,
      distance: data.accumulatedDistance ?? data.distance ?? accumulatedDistance,
      calories: data.calories,
    });

    if (w > maxPowerSeen) maxPowerSeen = w;
    if (w > 0) {
      powerSum += w;
      powerCount++;
      fourthPowerSum += Math.pow(w, 4);
    }

    $("maxPower").textContent = maxPowerSeen || "—";

    if (powerCount > 0) {
      $("avgPower").textContent = Math.round(powerSum / powerCount);
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

  // Use server-accumulated distance (prefer it over trainer's Distance which may report 0)
  accumulatedDistance = data.accumulatedDistance ?? accumulatedDistance;
  const distMeters = accumulatedDistance || 0;
  if (distMeters >= 1000) {
    $("distance").textContent = (distMeters / 1000).toFixed(2);
    $("distUnit").textContent = "km";
  } else {
    $("distance").textContent = Math.round(distMeters);
    $("distUnit").textContent = "m";
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

  // Use server-tracked session elapsed time
  sessionElapsed = data.elapsedTime ?? sessionElapsed;
  $("elapsed").textContent = formatTime(sessionElapsed);

  if (data.calories != null) {
    $("calories").textContent = data.calories;
  }

  document.body.classList.remove("stale");
  lastUpdate = now;
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
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "fitness") updateUI(data);
    else if (data.type === "status") updateStatus(data);
    else if (data.type === "sessionRestore") restoreSession(data);
    else if (data.type === "sessionReset") applyReset();
  };

  ws.onclose = () => {
    updateStatus({ status: "off", message: "" });
    setTimeout(connect, 2000);
  };

  ws.onerror = () => ws.close();
}

connect();
