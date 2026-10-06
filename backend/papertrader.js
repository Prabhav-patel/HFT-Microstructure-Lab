// papertrader.js — Live Paper Trading Engine (ES Module)
// Multi-signal composite strategy for BTCUSDT.
//
// READ THIS BEFORE INTERPRETING THE WIN RATE
// ------------------------------------------
// A near-zero net win rate does NOT mean the signal predicts the wrong
// direction. Measured on this feed:
//
//   median |price move| over the holding window   ~3.1 bps
//   round-trip cost (fee + spread)                ~8.0 bps
//
// Only ~8% of moves over that window are large enough to clear the hurdle, so
// even a PERFECT direction call would show a win rate near 8%. The strategy is
// mostly right and still loses, because it is taxed more than it earns.
//
// Three separate statistics are therefore tracked and reported:
//   directionalAccuracy  did price move the way we predicted?  (~50% expected)
//   grossWinRate         profitable before costs?
//   netWinRate           profitable after costs?
//
// To make the net win rate meaningful you must either hold long enough for the
// move to exceed the hurdle, or trade where the hurdle is smaller.

import { summarise } from './metrics.js';

const ENTRY_THRESHOLD  = 0.28;
const POSITION_SIZE    = 0.001;   // BTC
const STOP_MULT        = 4.0;
const TP_MULT          = 10.0;
const DAILY_LOSS_LIMIT = -50;     // USD
const FEE_RATE         = 0.0004;  // 0.04 % per side -> 0.08 % round-trip

// Capital base for percentage and annualised figures. The strategy is not
// margined here; this is the denominator that makes "return" meaningful.
const CAPITAL = 10000;

// Holding period, set to where the signal actually has predictive power.
// Measured directional accuracy on logged ticks (|signal| > threshold):
//
//     10 s   86.2%   mean forward move +0.654 bps
//     30 s   69.5%                     +0.620 bps
//     60 s   60.8%                     +0.488 bps
//    300 s   51.2%                     +0.124 bps
//   1200 s   52.0%                     +0.054 bps
//
// The signal is strong and decays to a coin flip within ~10 minutes. Holding
// longer to let the price move exceed the 8 bps cost does NOT work: accuracy
// decays faster than the move grows, so expected capture falls monotonically.
// 30 s is near the peak of expected gross capture.
//
// Note what this means. Even at the optimum the signal captures ~0.62 bps
// while the round trip costs ~8 bps — a 13x gap. The strategy is right far
// more often than not and still loses, because it is taxed more than it earns.
// No holding period fixes that; only a lower fee would.
const HOLD_SECONDS = 30;

// Equity sampled on a uniform clock so Sharpe and volatility annualise
// correctly. Sampling per tick would make them depend on feed rate.
//
// The interval must be near the holding period, not near the tick rate. The
// strategy holds ~20 minutes, so second-by-second equity samples are almost
// perfectly autocorrelated: 1200 near-identical observations per trade, which
// annualised to a Sharpe of -1395 and "-911% per year" from ninety minutes of
// data. Five-minute sampling keeps the observations closer to independent.
//
// The honest consequence is that Sharpe needs ~2.5 hours of running before it
// means anything (30 samples). Until then metrics.sampleQuality reports
// 'insufficient' and the UI says so rather than printing a fabricated number.
const EQUITY_SAMPLE_MS = 300000;

// Rolling price/signal tape driving the live chart. One point per second over
// five minutes: long enough to watch a 30 s position open and close in
// context, short enough to ship on every websocket frame.
//
// Size matters here because the whole tape goes out with each broadcast at
// ~5 frames/s. At the original 1500-point cap with object-shaped components
// that was ~195 KB per frame, near a megabyte a second. Points are therefore
// capped at 300 and the five factor contributions are stored as a FIXED-ORDER
// array rather than five keyed objects, which cuts the payload roughly 4x.
const TAPE_SAMPLE_MS = 1000;
const TAPE_MAX = 300;

// Fixed order for the packed contribution array. The chart relies on this;
// changing it without changing FACTOR_ORDER in LivePositionChart.jsx would
// silently mislabel every factor.
const FACTOR_ORDER = ['obi', 'ofi', 'ti', 'mcp', 'dwi'];

function clip(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

function pushFront(arr, value, maxLen) {
  arr.unshift(value);
  if (arr.length > maxLen) arr.length = maxLen;
}

class PaperTrader {
  constructor() {
    this._initState();
  }

  _initState() {
    this.position      = 0;
    this.entryPrice    = 0;
    this.entryMid      = 0;   // mid at entry, for judging direction honestly
    this.entrySignal   = 0;
    this.entryTs       = 0;
    this.stopLoss      = 0;
    this.takeProfit    = 0;
    this.holdTicks     = 0;

    this.pnl           = 0;   // realised NET
    this.grossPnl      = 0;   // realised before costs
    this.feesPaid      = 0;
    this.dailyPnl      = 0;
    this.unrealizedPnl = 0;

    this.trades        = [];  // newest first, capped for the UI
    this.closedTrades  = [];  // full history, for metrics
    this.equityCurve   = [];  // newest first, for the chart
    this._equitySeries = [];  // oldest first, uniform clock, for metrics
    this._nextSampleTs = 0;
    this.signalHistory = [];

    this.winCount      = 0;
    this.lossCount     = 0;
    this.tickCount     = 0;

    this.isActive         = true;
    this.killSwitchReason = null;

    this.lastSignal     = 0;
    this.lastComponents = [];
    this.lastDominant   = null;
    this.lastVolScale   = 1;
    this.priceTape      = [];
    this._lastTapeTs    = 0;
    this.lastMid        = 0;
    this.lastSpreadBps  = 0;
    this.startTs       = Date.now();

    // Fee actually charged, switchable at runtime so the cost drag can be
    // isolated on the live dashboard. Defaults to the real tier; a session run
    // at zero fee is a DIAGNOSTIC, not a result, and is labelled as such.
    if (this.feeRate === undefined) this.feeRate = FEE_RATE;
  }

  /**
   * Composite signal, returned together with a per-factor breakdown.
   *
   * The breakdown is what makes a trade explainable. A bare signal value says
   * a position was opened; the contributions say WHICH microstructure feature
   * drove it, and therefore what to distrust when the trade goes wrong.
   *
   * contribution = weight x clip(value) x volScale, so the contributions sum
   * exactly to the signal. Anything else would be a plausible-looking
   * attribution that does not reconcile.
   */
  _computeSignal(mid, spread, features) {
    const get = (key) => {
      const f = features[key];
      return f !== undefined
        ? (typeof f === 'object' && f !== null ? (f.value ?? 0) : Number(f))
        : 0;
    };

    const obi     = get('obi');
    const ofi_raw = get('ofi');
    const ti      = get('ti');
    const mcp     = get('mcp');
    const dwi     = get('dwi');
    const pvol    = get('pvol');

    const denom    = spread * 200;
    const ofi_norm = denom !== 0 ? ofi_raw / denom : 0;
    const mcp_skew = spread !== 0 ? (mcp - mid) / spread : 0;

    const volScale = pvol < 1.0 ? 1.00 : pvol < 3.5 ? 0.75 : 0.45;

    const parts = [
      { key: 'obi', label: 'Order Book Imbalance',  weight: 0.30, raw: obi },
      { key: 'ofi', label: 'Order Flow Imbalance',  weight: 0.25, raw: ofi_norm },
      { key: 'ti',  label: 'Trade Imbalance',       weight: 0.20, raw: ti },
      { key: 'mcp', label: 'Micro-Price Skew',      weight: 0.15, raw: mcp_skew },
      { key: 'dwi', label: 'Depth-Weighted Imb.',   weight: 0.10, raw: dwi },
    ];

    let raw = 0;
    const components = parts.map((p) => {
      const clipped = clip(p.raw);
      const contribution = p.weight * clipped * volScale;
      raw += p.weight * clipped;
      return {
        key: p.key, label: p.label, weight: p.weight,
        raw: p.raw, clipped, contribution,
      };
    });

    const value = raw * volScale;

    // Rank by absolute contribution: the first entry is the reason for the trade.
    const ranked = [...components].sort(
      (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      value,
      components,
      volScale,
      pvol,
      dominant: ranked[0] ? ranked[0].key : null,
      dominantLabel: ranked[0] ? ranked[0].label : null,
    };
  }

  _closePosition(fillPrice, reason, mid) {
    const size  = POSITION_SIZE;
    const fee   = fillPrice * size * this.feeRate * 2;   // round-trip
    const gross = this.position * (fillPrice - this.entryPrice) * size;
    const net   = gross - fee;

    // Direction is judged MID-to-MID, independent of what we paid to get in
    // and out. Conflating direction with cost is exactly what makes a working
    // signal look broken.
    const midMove          = mid - this.entryMid;
    const directionCorrect = this.position > 0 ? midMove > 0 : midMove < 0;
    const notional         = fillPrice * size;

    this.pnl      += net;
    this.grossPnl += gross;
    this.feesPaid += fee;
    this.dailyPnl += net;

    if (net >= 0) this.winCount++;
    else          this.lossCount++;

    const trade = {
      id         : this.closedTrades.length + 1,
      side       : this.position > 0 ? 'LONG' : 'SHORT',
      entry      : this.entryPrice,
      exit       : fillPrice,
      entryMid   : this.entryMid,
      exitMid    : mid,
      size,
      grossPnl   : gross,
      fee,
      netPnl     : net,
      pnl        : net,                    // retained for the existing UI
      notional,
      moveBps    : this.entryMid > 0 ? (midMove / this.entryMid) * 1e4 : 0,
      directionCorrect,
      entrySignal: this.entrySignal,
      entryComponents: this.entryComponents,
      entryDominant: this.entryDominant,
      holdSeconds: this.entryTs ? (Date.now() - this.entryTs) / 1000 : 0,
      reason,
      tick       : this.tickCount,
      timestamp  : Date.now(),
    };

    pushFront(this.trades, trade, 100);
    this.closedTrades.push(trade);

    this.position      = 0;
    this.entryPrice    = 0;
    this.entryMid      = 0;
    this.holdTicks     = 0;
    this.unrealizedPnl = 0;

    if (this.dailyPnl < DAILY_LOSS_LIMIT) {
      this.isActive         = false;
      this.killSwitchReason = 'Daily loss limit hit: $' + this.dailyPnl.toFixed(2);
    }

    return net;
  }

  _openPosition(direction, fillPrice, spread, mid, signal, components, dominant) {
    // BTCUSDT spread can be $0.01, making 4x-spread stops microscopic and
    // fee-dominated. Floor it so the stop sits outside the noise.
    const minSpread = fillPrice * 0.0002;
    const effSpread = Math.max(spread, minSpread);

    this.position    = direction;
    this.entryPrice  = fillPrice;
    this.entryMid    = mid;
    this.entrySignal     = signal;
    this.entryComponents = components || [];
    this.entryDominant   = dominant || null;
    this.entryTs         = Date.now();
    this.holdTicks       = 0;

    if (direction > 0) {
      this.stopLoss   = fillPrice - effSpread * STOP_MULT;
      this.takeProfit = fillPrice + effSpread * TP_MULT;
    } else {
      this.stopLoss   = fillPrice + effSpread * STOP_MULT;
      this.takeProfit = fillPrice - effSpread * TP_MULT;
    }
  }

  update(tick) {
    if (!this.isActive) return;

    const mid    = Number(tick.mid_price) || 0;
    const spread = Math.max(Number(tick.spread) || 0, 1e-8);
    if (mid <= 0) return;

    this.tickCount++;
    this.lastMid = mid;
    this.lastSpreadBps = (spread / mid) * 1e4;

    const sig    = this._computeSignal(mid, spread, tick.features || {});
    const signal = sig.value;
    this.lastSignal     = signal;
    this.lastComponents = sig.components;
    this.lastDominant   = sig.dominantLabel;
    this.lastVolScale   = sig.volScale;
    pushFront(this.signalHistory, signal, 120);

    // Rolling price/signal tape for the live chart. Sampled rather than stored
    // per tick: at ~5 ticks/s an unsampled tape would be tens of thousands of
    // points per hour, most of them visually indistinguishable.
    const nowMs = Date.now();
    if (nowMs - this._lastTapeTs >= TAPE_SAMPLE_MS) {
      this._lastTapeTs = nowMs;
      // Rounded and packed: full float precision is invisible on a chart and
      // roughly doubles the payload. Contributions keep 6 decimals rather than
      // 4 so they still sum to the displayed signal exactly at the 4 decimals
      // the tooltip shows — the panel's whole claim is that the factors add up,
      // and visible rounding drift would undermine it for ~3 KB.
      this.priceTape.push({
        ts: nowMs,
        mid: Math.round(mid * 100) / 100,
        signal: Math.round(signal * 1e6) / 1e6,
        pos: this.position,
        c: sig.components.map((x) => Math.round(x.contribution * 1e6) / 1e6),
        dom: sig.dominant,
      });
      if (this.priceTape.length > TAPE_MAX) this.priceTape.shift();
    }

    const bid = mid - spread * 0.5;
    const ask = mid + spread * 0.5;

    if (this.position !== 0) {
      this.holdTicks++;
      this.unrealizedPnl = this.position * (mid - this.entryPrice) * POSITION_SIZE;

      const heldSec = this.entryTs ? (Date.now() - this.entryTs) / 1000 : 0;
      let exited = false;

      if (this.position > 0) {
        const exitPrice = bid;
        if (mid <= this.stopLoss) {
          this._closePosition(exitPrice, 'STOP_LOSS', mid); exited = true;
        } else if (mid >= this.takeProfit) {
          this._closePosition(exitPrice, 'TAKE_PROFIT', mid); exited = true;
        } else if (signal < -0.10) {
          this._closePosition(exitPrice, 'SIGNAL_REVERSAL', mid); exited = true;
        } else if (heldSec >= HOLD_SECONDS) {
          this._closePosition(exitPrice, 'MAX_HOLD', mid); exited = true;
        }
      } else {
        const exitPrice = ask;
        if (mid >= this.stopLoss) {
          this._closePosition(exitPrice, 'STOP_LOSS', mid); exited = true;
        } else if (mid <= this.takeProfit) {
          this._closePosition(exitPrice, 'TAKE_PROFIT', mid); exited = true;
        } else if (signal > 0.10) {
          this._closePosition(exitPrice, 'SIGNAL_REVERSAL', mid); exited = true;
        } else if (heldSec >= HOLD_SECONDS) {
          this._closePosition(exitPrice, 'MAX_HOLD', mid); exited = true;
        }
      }

      if (!this.isActive) { this._updateEquity(); return; }
      if (!exited)        { this._updateEquity(); return; }
    }

    if (this.position === 0) {
      if (signal > ENTRY_THRESHOLD) {
        this._openPosition(+1, ask, spread, mid, signal, sig.components, sig.dominantLabel);
      } else if (signal < -ENTRY_THRESHOLD) {
        this._openPosition(-1, bid, spread, mid, signal, sig.components, sig.dominantLabel);
      }
      if (this.position !== 0) {
        this.unrealizedPnl = this.position * (mid - this.entryPrice) * POSITION_SIZE;
      }
    }

    this._updateEquity();
  }

  _updateEquity() {
    const equity = this.pnl + this.unrealizedPnl;
    pushFront(this.equityCurve, equity, 300);

    // Uniform-clock sample for Sharpe / volatility / drawdown.
    const now = Date.now();
    if (this._nextSampleTs === 0) this._nextSampleTs = now;
    while (now >= this._nextSampleTs) {
      this._equitySeries.push(equity);
      this._nextSampleTs += EQUITY_SAMPLE_MS;
      if (this._equitySeries.length > 86400) this._equitySeries.shift();
    }
  }

  getState() {
    const totalTrades = this.winCount + this.lossCount;
    const winRate     = totalTrades > 0 ? (this.winCount / totalTrades) * 100 : 0;

    let positionLabel;
    if      (this.position > 0) positionLabel = 'LONG';
    else if (this.position < 0) positionLabel = 'SHORT';
    else                        positionLabel = 'FLAT';

    const spanSec = Math.max((Date.now() - this.startTs) / 1000, 1);
    const metrics = summarise(
      this.closedTrades, this._equitySeries,
      EQUITY_SAMPLE_MS / 1000, spanSec, CAPITAL,
    );

    // The hurdle a trade must clear before it can possibly be a win.
    const feeBps    = this.feeRate * 2 * 1e4;
    const hurdleBps = feeBps + this.lastSpreadBps;

    return {
      position       : this.position,
      positionLabel,
      entryPrice     : this.entryPrice,
      stopLoss       : this.stopLoss,
      takeProfit     : this.takeProfit,
      holdTicks      : this.holdTicks,

      pnl            : this.pnl,
      grossPnl       : this.grossPnl,
      feesPaid       : this.feesPaid,
      dailyPnl       : this.dailyPnl,
      unrealizedPnl  : this.unrealizedPnl,
      totalPnl       : this.pnl + this.unrealizedPnl,

      trades         : this.trades,
      equityCurve    : this.equityCurve,
      signalHistory  : this.signalHistory,

      winCount       : this.winCount,
      lossCount      : this.lossCount,
      totalTrades,
      winRate,
      tickCount      : this.tickCount,

      lastSignal     : this.lastSignal,
      lastComponents : this.lastComponents,
      lastDominant   : this.lastDominant,
      lastVolScale   : this.lastVolScale,
      priceTape      : this.priceTape,
      factorOrder    : FACTOR_ORDER,
      entryDominant  : this.entryDominant ?? null,
      entryComponents: this.entryComponents ?? [],
      entryTs        : this.entryTs,
      lastMid        : this.lastMid,

      isActive       : this.isActive,
      killSwitchReason : this.killSwitchReason,

      // Full statistics, plus the cost context needed to read them correctly.
      metrics,
      costs: {
        feeRatePerSide : this.feeRate,
        liveFeeRate    : FEE_RATE,
        // 'live'  = the real exchange tier
        // 'zero'  = fees switched off to isolate signal quality; results in
        //           this mode are diagnostic and not achievable
        feeModel       : this.feeRate === 0 ? 'zero' : (this.feeRate === FEE_RATE ? 'live' : 'custom'),
        feeBpsRoundTrip: feeBps,
        spreadBps      : this.lastSpreadBps,
        hurdleBps,
        capital        : CAPITAL,
        holdSeconds    : HOLD_SECONDS,
        positionSize   : POSITION_SIZE,
        entryThreshold : ENTRY_THRESHOLD,
      },
    };
  }

  /**
   * Change the fee and restart the session.
   *
   * The reset is deliberate: leaving prior trades in place would blend two
   * cost regimes into one set of statistics, and the resulting win rate would
   * describe neither.
   */
  setFeeRate(rate) {
    const r = Number(rate);
    if (!Number.isFinite(r) || r < 0 || r > 0.01) return false;
    this.feeRate = r;
    this._initState();
    this.feeRate = r;   // survive the reset
    return true;
  }

  reset() {
    const keep = this.feeRate;
    this._initState();
    this.feeRate = keep;
  }

  reactivate() {
    this.isActive         = true;
    this.killSwitchReason = null;
    this.dailyPnl         = 0;
  }
}

export default new PaperTrader();
