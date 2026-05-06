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
    const payload = {
      type: "fitness",
      deviceId: state.DeviceId,
      equipmentType: state.EquipmentType,
      state: state.State,
      speed: num(state.RealSpeed) ?? num(state.VirtualSpeed),
      cadence: num(state.Cadence),
      power: num(state.InstantaneousPower),
      averagePower: num(state.AveragePower),
      heartRate: num(state.HeartRate),
      distance: num(state.Distance),
      elapsedTime: num(state.ElapsedTime),
      calories: num(state.Calories),
      resistance: num(state.Resistance),
      incline: num(state.Incline),
      accumulatedPower: num(state.AccumulatedPower),
      torque: num(state.Torque),
      trainerStatus: state.TrainerStatus ?? null,
      targetStatus: state.TargetStatus ?? null,
      timestamp: Date.now(),
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
