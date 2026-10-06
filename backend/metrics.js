// metrics.js — performance statistics shared by the paper trader and backtester.
//
// Why these are separated the way they are
// ----------------------------------------
// A single "win rate" hides the most important fact about a strategy. Three
// different questions get conflated:
//
//   DIRECTIONAL ACCURACY  did price move the way we predicted?
//   GROSS WIN RATE        did the trade make money before costs?
//   NET WIN RATE          did it make money after costs?
//
// When the cost hurdle is larger than the typical price move over the holding
// period, net win rate is near zero even when directional accuracy is a
// perfectly healthy ~50%. Reporting only the net number makes a working signal
// look broken. All three are reported here so the difference is visible.

/** Sample standard deviation. */
function stdev(xs) {
  const n = xs.length;
  if (n < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
  return Math.sqrt(v);
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Annualised Sharpe ratio from returns sampled on a UNIFORM CLOCK.
 *
 * The previous implementation used sqrt(15_768_000 / n) on per-TRADE returns,
 * which treats the trade count as a number of seconds — so the "annualisation"
 * changed with how often the strategy happened to trade. That is not a Sharpe
 * ratio in any sense.
 *
 * @param {number[]} returns  per-period returns (fraction of capital)
 * @param {number} periodSec  seconds represented by one period
 */
function sharpe(returns, periodSec) {
  if (returns.length < 30 || periodSec <= 0) return 0;
  const sd = stdev(returns);
  if (sd === 0) return 0;
  const periodsPerYear = (365 * 24 * 3600) / periodSec;
  return (mean(returns) / sd) * Math.sqrt(periodsPerYear);
}

/** Annualised volatility, in percent. */
function volatility(returns, periodSec) {
  if (returns.length < 3 || periodSec <= 0) return 0;
  const periodsPerYear = (365 * 24 * 3600) / periodSec;
  return stdev(returns) * Math.sqrt(periodsPerYear) * 100;
}

/** Maximum peak-to-trough drawdown of an equity series, and its depth in %. */
function maxDrawdown(equity, capital) {
  if (!equity || equity.length < 2) return { abs: 0, pct: 0 };
  let peak = equity[0];
  let worst = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > worst) worst = dd;
  }
  return { abs: worst, pct: capital > 0 ? (worst / capital) * 100 : 0 };
}

/**
 * Full summary for a set of closed trades plus a uniformly sampled equity curve.
 *
 * @param {object[]} trades  each needs { grossPnl, netPnl, fee, directionCorrect }
 * @param {number[]} equity  equity sampled on a uniform clock, OLDEST FIRST
 * @param {number} periodSec seconds per equity sample
 * @param {number} spanSec   wall-clock seconds the session has run
 * @param {number} capital   capital base for percentage figures
 */
function summarise(trades, equity, periodSec, spanSec, capital) {
  const n = trades.length;
  const gross = trades.reduce((a, t) => a + t.grossPnl, 0);
  const fees = trades.reduce((a, t) => a + t.fee, 0);
  const net = trades.reduce((a, t) => a + t.netPnl, 0);

  const grossWins = trades.filter((t) => t.grossPnl > 0).length;
  const netWins = trades.filter((t) => t.netPnl > 0).length;
  const correct = trades.filter((t) => t.directionCorrect).length;

  const longs = trades.filter((t) => t.side === 'LONG');
  const shorts = trades.filter((t) => t.side === 'SHORT');
  const longHits = longs.filter((t) => t.directionCorrect).length;
  const shortHits = shorts.filter((t) => t.directionCorrect).length;

  const winsPnl = trades.filter((t) => t.netPnl > 0).reduce((a, t) => a + t.netPnl, 0);
  const lossPnl = -trades.filter((t) => t.netPnl < 0).reduce((a, t) => a + t.netPnl, 0);

  // Returns on capital, from the uniformly sampled equity curve.
  const rets = [];
  for (let i = 1; i < equity.length; i++) rets.push((equity[i] - equity[i - 1]) / capital);

  const dd = maxDrawdown(equity, capital);

  // Extrapolating a short session to a full year produces numbers like
  // "-911% annualised" from ninety minutes of data. Mathematically it is just
  // multiplication; as a statistic it is meaningless and actively misleading.
  // Annualised figures are only reported once the session is long enough to
  // carry them, and sampleQuality says which regime we are in.
  const MIN_ANNUALISE_SEC = 6 * 3600;
  const canAnnualise = spanSec >= MIN_ANNUALISE_SEC;
  const annualFactor = canAnnualise ? (365 * 24 * 3600) / spanSec : 0;
  const MIN_SHARPE_SAMPLES = 30;
  const haveSamples = Math.max(equity.length - 1, 0);
  const sharpeReliable = haveSamples >= MIN_SHARPE_SAMPLES;
  const sampleQuality =
    n < 20 || !sharpeReliable ? 'insufficient' : !canAnnualise ? 'short' : 'ok';

  const notional = trades.reduce((a, t) => a + t.notional, 0);

  return {
    // headline
    totalTrades: n,
    grossPnl: gross,
    fees,
    netPnl: net,

    // the three different "win" questions
    directionalAccuracy: n ? (correct / n) * 100 : 0,
    grossWinRate: n ? (grossWins / n) * 100 : 0,
    netWinRate: n ? (netWins / n) * 100 : 0,

    // per-side precision
    longTrades: longs.length,
    shortTrades: shorts.length,
    longPrecision: longs.length ? (longHits / longs.length) * 100 : 0,
    shortPrecision: shorts.length ? (shortHits / shorts.length) * 100 : 0,

    // costs, in basis points of what was actually traded
    notionalTraded: notional,
    grossBps: notional ? (gross / notional) * 1e4 : 0,
    feeBps: notional ? (fees / notional) * 1e4 : 0,
    netBps: notional ? (net / notional) * 1e4 : 0,

    // risk / return
    sharpe: sharpe(rets, periodSec),
    sharpeReliable,
    equitySamples: haveSamples,
    equitySamplesNeeded: MIN_SHARPE_SAMPLES,
    volatilityPct: volatility(rets, periodSec),
    maxDrawdown: dd.abs,
    maxDrawdownPct: dd.pct,
    annualisedReturnPct: canAnnualise && capital > 0
      ? (net / capital) * annualFactor * 100 : null,
    canAnnualise,
    sampleQuality,
    returnPct: capital > 0 ? (net / capital) * 100 : 0,

    // trade quality
    avgTradePnl: n ? net / n : 0,
    avgWin: netWins ? winsPnl / netWins : 0,
    avgLoss: n - netWins ? lossPnl / (n - netWins) : 0,
    profitFactor: lossPnl > 0 ? winsPnl / lossPnl : (winsPnl > 0 ? Infinity : 0),
    expectancy: n ? net / n : 0,

    spanSeconds: spanSec,
  };
}

export { summarise, sharpe, volatility, maxDrawdown, stdev, mean };
