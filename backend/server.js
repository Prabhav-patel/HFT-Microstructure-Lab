import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import logger from './logger.js';
import paperTrader from './papertrader.js';
import { runBacktest } from './backtester.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve static assets from frontend build folder
const frontendBuildPath = path.resolve(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendBuildPath));

const PORT = process.env.PORT || 3001;
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let activeProcess = null;
let isEngineRunning = false;
const clients = new Set();

// Resolve paths
const ENGINE_DIR = path.resolve(__dirname, '..');
const ENGINE_PATH = path.join(ENGINE_DIR, 'engine.exe');

console.log(`[Backend] Resolved engine executable path: ${ENGINE_PATH}`);

// Helper to broadcast status/data to all WebSocket clients
function broadcast(messageObj) {
  const messageStr = JSON.stringify(messageObj);
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(messageStr);
    }
  }
}

// Function to start the C++ engine subprocess
function startEngine() {
  if (isEngineRunning || activeProcess) {
    console.log('[Backend] Engine is already running.');
    return;
  }

  console.log('[Backend] Spawning C++ Engine...');

  activeProcess = spawn(ENGINE_PATH, ['--json'], {
    cwd: ENGINE_DIR
  });

  isEngineRunning = true;
  broadcast({ type: 'status', running: true });

  const rl = readline.createInterface({
    input: activeProcess.stdout,
    terminal: false
  });

  rl.on('line', (line) => {
    try {
      const parsedData = JSON.parse(line.trim());

      // Feed tick into logger and paper trader
      logger.writeTick(parsedData);
      paperTrader.update(parsedData);

      // Enrich payload with paper trading state and logger status
      broadcast({
        type: 'data',
        payload: {
          ...parsedData,
          paper_trading: paperTrader.getState(),
          logger_status: logger.status()
        }
      });
    } catch (err) {
      if (line.trim()) {
        broadcast({ type: 'log', payload: line.trim() });
      }
    }
  });

  activeProcess.stderr.on('data', (data) => {
    const errorStr = data.toString().trim();
    if (errorStr) {
      console.error(`[C++ Engine Error] ${errorStr}`);
      broadcast({ type: 'log', payload: `[ERROR] ${errorStr}` });
    }
  });

  activeProcess.on('close', (code) => {
    console.log(`[Backend] C++ Engine process exited with code ${code}`);
    cleanupProcess();
  });

  activeProcess.on('error', (err) => {
    console.error('[Backend] Failed to start engine subprocess:', err);
    broadcast({ type: 'log', payload: `[ERROR] Failed to start subprocess: ${err.message}` });
    cleanupProcess();
  });
}

// Function to stop the C++ engine subprocess
function stopEngine() {
  if (!activeProcess) {
    console.log('[Backend] Engine is not running.');
    return;
  }

  console.log('[Backend] Stopping C++ Engine process...');
  activeProcess.kill('SIGTERM');

  const killTimeout = setTimeout(() => {
    if (activeProcess) {
      console.log('[Backend] Engine did not respond to SIGTERM. Forcing close...');
      activeProcess.kill('SIGKILL');
      cleanupProcess();
    }
  }, 1000);

  activeProcess.on('close', () => {
    clearTimeout(killTimeout);
  });
}

function cleanupProcess() {
  activeProcess = null;
  isEngineRunning = false;
  broadcast({ type: 'status', running: false });
}

// REST API — engine status
app.get('/api/status', (req, res) => {
  res.json({ running: isEngineRunning });
});

// REST API — tick logger
app.get('/api/logger/status', (req, res) => {
  res.json(logger.status());
});

app.post('/api/logger/toggle', (req, res) => {
  const { enabled } = req.body;
  logger.setEnabled(!!enabled);
  res.json({ ok: true, enabled: !!enabled });
});

// REST API — backtest
app.get('/api/backtest/run', (req, res) => {
  const ticks = logger.getTicksForBacktest(5000);
  const results = runBacktest(ticks);
  res.json(results);
});

// REST API — paper trader control
app.get('/api/paper/state', (req, res) => {
  res.json(paperTrader.getState());
});

app.post('/api/paper/reset', (req, res) => {
  paperTrader.reset();
  res.json({ ok: true, message: 'Paper trader session reset.' });
});

app.post('/api/paper/reactivate', (req, res) => {
  paperTrader.reactivate();
  res.json({ ok: true, message: 'Kill-switch reset, trading re-enabled.' });
});

// Switch the fee charged by the paper trader. Sending 0 isolates signal
// quality from cost drag — useful for diagnosis, but a zero-fee session
// describes a market that does not exist, so the UI labels it accordingly.
// Changing the fee restarts the session; blending two cost regimes into one
// win rate would describe neither.
app.post('/api/paper/fee', (req, res) => {
  const { feeRate } = req.body;
  if (!paperTrader.setFeeRate(feeRate)) {
    return res.status(400).json({
      ok: false,
      message: 'feeRate must be a number between 0 and 0.01 (0 to 1% per side).',
    });
  }
  const bps = Number(feeRate) * 2 * 1e4;
  res.json({
    ok: true,
    feeRate: Number(feeRate),
    roundTripBps: bps,
    message: `Fee set to ${(Number(feeRate) * 100).toFixed(4)}% per side ` +
             `(${bps.toFixed(2)} bps round trip). Session reset.`,
  });
});

// WebSocket Server Handler
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[Backend] Client connected. Active clients: ${clients.size}`);

  // Send current engine status and paper trader state on connect
  ws.send(JSON.stringify({ type: 'status', running: isEngineRunning }));

  ws.on('message', (message) => {
    try {
      const command = JSON.parse(message);
      if (command.type === 'START_ENGINE') {
        startEngine();
      } else if (command.type === 'STOP_ENGINE') {
        stopEngine();
      }
    } catch (e) {
      console.error('[Backend] Received invalid websocket message:', message.toString());
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[Backend] Client disconnected. Active clients: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[Backend] WebSocket client error:', err);
    clients.delete(ws);
  });
});

// Fallback route to serve React app for client-side routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(frontendBuildPath, 'index.html'));
});

// Clean up processes when server closes
function shutdown() {
  console.log('[Backend] Shutting down backend server...');
  if (activeProcess) {
    activeProcess.kill();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Backend] HTTP and WS Server running on port ${PORT}`);
});
