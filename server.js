import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";
import * as Ant from "ant-plus-next";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".svg": "image/svg+xml",
};

// In-memory exercise session state
let session = {
  exerciseData: [],
  maxPowerSeen: 0,
  powerSum: 0,
  powerCount: 0,
  fourthPowerSum: 0,
  accumulatedDistance: 0,
  startedAt: null,
};

function resetSession() {
  session = {
    exerciseData: [],
    maxPowerSeen: 0,
    powerSum: 0,
    powerCount: 0,
    fourthPowerSum: 0,
    accumulatedDistance: 0,
    startedAt: null,
  };
}

let lastSpeedTime = null;

const httpServer = createServer(async (req, res) => {
  let filePath;
  if (req.url === "/" || req.url === "/index.html") {
    filePath = join(__dirname, "public", "index.html");
  } else {
    filePath = join(__dirname, "public", req.url);
  }

  const ext = filePath.substring(filePath.lastIndexOf("."));
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

const wss = new WebSocketServer({ server: httpServer });

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

let stick = null;
let scanner = null;
let connected = false;

function startAnt() {
  stick = new Ant.GarminStick2();

  scanner = new Ant.FitnessEquipmentScanner(stick);

  scanner.on("fitnessData", (state) => {
    const num = (v) => (v != null && Number.isFinite(v) ? v : null);
    const now = Date.now();
    const speed = num(state.RealSpeed) ?? num(state.VirtualSpeed);
    const power = num(state.InstantaneousPower);

    // Accumulate distance from speed
    if (speed != null && speed > 0 && lastSpeedTime != null) {
      const dt = (now - lastSpeedTime) / 1000;
      if (dt > 0 && dt < 10) {
        session.accumulatedDistance += speed * dt;
      }
    }
    if (speed != null) lastSpeedTime = now;

    // Track session start
    if (power != null && session.startedAt === null) {
      session.startedAt = now;
    }

    // Store data point
    const point = {
      ts: now,
      power: power ?? 0,
      speed,
      cadence: num(state.Cadence),
      hr: num(state.HeartRate),
      distance: num(state.Distance) ?? session.accumulatedDistance,
      calories: num(state.Calories),
    };
    session.exerciseData.push(point);

    const w = power ?? 0;
    if (w > session.maxPowerSeen) session.maxPowerSeen = w;
    if (w > 0) {
      session.powerSum += w;
      session.powerCount++;
      session.fourthPowerSum += Math.pow(w, 4);
    }

    const sessionElapsed = session.startedAt ? (now - session.startedAt) / 1000 : 0;

    const payload = {
      type: "fitness",
      deviceId: state.DeviceId,
      equipmentType: state.EquipmentType,
      state: state.State,
      speed,
      cadence: num(state.Cadence),
      power,
      averagePower: num(state.AveragePower),
      heartRate: num(state.HeartRate),
      distance: num(state.Distance),
      elapsedTime: sessionElapsed,
      calories: num(state.Calories),
      resistance: num(state.Resistance),
      incline: num(state.Incline),
      accumulatedPower: num(state.AccumulatedPower),
      torque: num(state.Torque),
      trainerStatus: state.TrainerStatus ?? null,
      targetStatus: state.TargetStatus ?? null,
      accumulatedDistance: session.accumulatedDistance,
      timestamp: now,
    };
    broadcast(payload);
  });

  stick.on("startup", () => {
    connected = true;
    broadcast({ type: "status", status: "connected", message: "ANT+ stick connected. Scanning for fitness equipment..." });
    scanner.scan();
  });

  stick.on("shutdown", () => {
    connected = false;
    broadcast({ type: "status", status: "disconnected", message: "ANT+ stick disconnected" });
    setTimeout(() => startAnt(), 3000);
  });

  stick.open().then((result) => {
    if (!result) {
      console.error("ANT+ stick not found. Retrying in 5s...");
      broadcast({ type: "status", status: "error", message: "ANT+ stick not found. Retrying..." });
      setTimeout(() => startAnt(), 5000);
    }
  }).catch((err) => {
    console.error("Error opening ANT+ stick:", err.message);
    broadcast({ type: "status", status: "error", message: `Error: ${err.message}. Retrying...` });
    setTimeout(() => startAnt(), 5000);
  });
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({
    type: "status",
    status: connected ? "connected" : "disconnected",
    message: connected ? "ANT+ stick connected. Scanning..." : "Waiting for ANT+ stick...",
  }));

  // Send current session snapshot so the client can recover
  if (session.exerciseData.length > 0) {
    ws.send(JSON.stringify({
      type: "sessionRestore",
      exerciseData: session.exerciseData,
      maxPowerSeen: session.maxPowerSeen,
      powerSum: session.powerSum,
      powerCount: session.powerCount,
      fourthPowerSum: session.fourthPowerSum,
      accumulatedDistance: session.accumulatedDistance,
      startedAt: session.startedAt,
    }));
  }

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "resetSession") {
        resetSession();
        lastSpeedTime = null;
        broadcast({ type: "sessionReset" });
      }
    } catch {}
  });
});

httpServer.listen(PORT, () => {
  console.log(`ANT+ Monitor running at http://localhost:${PORT}`);
  startAnt();
});

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  if (scanner) {
    try { await scanner.detach(); } catch {}
  }
  if (stick) {
    try { stick.close(); } catch {}
  }
  process.exit(0);
});
