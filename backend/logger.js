import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TickLogger {
  constructor() {
    this._enabled = true;
    this._rowCount = 0;
    this._lastTimestamp = null;
    this._currentDate = null;
    this._fileName = null;
    this._writeStream = null;
    this._dataDir = path.join(__dirname, 'data');

    // Ensure data directory exists
    if (!fs.existsSync(this._dataDir)) {
      fs.mkdirSync(this._dataDir, { recursive: true });
    }

    this._openStream();
  }

  _getDateString() {
    return new Date().toISOString().slice(0, 10);
  }

  _openStream() {
    const dateStr = this._getDateString();
    this._currentDate = dateStr;
    this._fileName = `ticks_${dateStr}.jsonl`;
    const filePath = path.join(this._dataDir, this._fileName);

    // Close existing stream if open
    if (this._writeStream) {
      try {
        this._writeStream.end();
      } catch (e) {
        // ignore
      }
      this._writeStream = null;
    }

    // Count existing rows if file already exists
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim().length > 0);
        this._rowCount = lines.length;
      } catch (e) {
        this._rowCount = 0;
      }
    } else {
      this._rowCount = 0;
    }

    this._writeStream = fs.createWriteStream(filePath, { flags: 'a' });

    this._writeStream.on('error', (err) => {
      console.error(`[TickLogger] Write stream error for ${this._fileName}:`, err);
    });
  }

  _checkRotate() {
    const dateStr = this._getDateString();
    if (dateStr !== this._currentDate) {
      this._openStream();
    }
  }

  writeTick(payload) {
    if (!this._enabled) return;

    this._checkRotate();

    const ts = Date.now();
    const mid = payload.mid_price ?? null;
    const bid = payload.best_bid  ?? null;
    const ask = payload.best_ask  ?? null;
    const spr = payload.spread    ?? (bid != null && ask != null ? ask - bid : null);

    // Extract feature values from payload.features
    const f = {};
    if (payload.features && typeof payload.features === 'object') {
      for (const [key, val] of Object.entries(payload.features)) {
        if (val !== null && val !== undefined) {
          if (typeof val === 'object' && 'value' in val) {
            f[key] = val.value;
          } else {
            f[key] = val;
          }
        }
      }
    }

    const record = { ts, mid, bid, ask, spr, f };

    const line = JSON.stringify(record) + '\n';

    this._writeStream.write(line, (err) => {
      if (err) {
        console.error('[TickLogger] Failed to write tick:', err);
      }
    });

    this._rowCount++;
    this._lastTimestamp = ts;
  }

  status() {
    this._checkRotate();

    let fileSizeKB = 0;
    if (this._fileName) {
      const filePath = path.join(this._dataDir, this._fileName);
      try {
        const stat = fs.statSync(filePath);
        fileSizeKB = Math.round((stat.size / 1024) * 100) / 100;
      } catch (e) {
        fileSizeKB = 0;
      }
    }

    return {
      enabled: this._enabled,
      rowCount: this._rowCount,
      fileSizeKB,
      lastTimestamp: this._lastTimestamp,
      fileName: this._fileName,
    };
  }

  setEnabled(bool) {
    this._enabled = Boolean(bool);
  }

  getTicksForBacktest(maxRows = 5000) {
    this._checkRotate();

    if (!this._fileName) return [];

    const filePath = path.join(this._dataDir, this._fileName);

    if (!fs.existsSync(filePath)) return [];

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content
        .split('\n')
        .filter(line => line.trim().length > 0);

      // Take last maxRows lines
      const sliced = lines.length > maxRows ? lines.slice(lines.length - maxRows) : lines;

      const ticks = [];
      for (const line of sliced) {
        try {
          ticks.push(JSON.parse(line));
        } catch (e) {
          // skip malformed lines
        }
      }
      return ticks;
    } catch (e) {
      console.error('[TickLogger] Failed to read ticks for backtest:', e);
      return [];
    }
  }
}

export default new TickLogger();
