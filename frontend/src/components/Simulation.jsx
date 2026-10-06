import { useState, useEffect, useRef } from 'react';

// ─── API base resolution ──────────────────────────────────────────────────────
function getApiBase() {
  const host = window.location.hostname || 'localhost';
  const port =
    window.location.port === '5173'
      ? '3001'
      : window.location.port || '3001';
  return `http://${host}:${port}`;
}

// ─── Equity curve canvas renderer ────────────────────────────────────────────
function drawEquityCurve(canvas, equityCurve) {
  if (!canvas || !equityCurve || equityCurve.length < 2) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const PAD = { top: 12, right: 12, bottom: 20, left: 52 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 6);
  ctx.fill();

  // ── Oscilloscope scan-line grid ─────────────────────────────────────────────
  // Horizontal lines at 25% intervals — phosphor green tint
  const GRID_LINES = 4;
  for (let i = 0; i <= GRID_LINES; i++) {
    const y = PAD.top + (i / GRID_LINES) * cH;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,229,255,0.07)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 6]);
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + cW, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Vertical tick markers every ~20% of data width
  const V_TICKS = 5;
  for (let i = 0; i <= V_TICKS; i++) {
    const x = PAD.left + (i / V_TICKS) * cW;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,229,255,0.05)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([2, 8]);
    ctx.moveTo(x, PAD.top);
    ctx.lineTo(x, PAD.top + cH);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Compute scale ───────────────────────────────────────────────────────────
  const minVal  = Math.min(...equityCurve);
  const maxVal  = Math.max(...equityCurve);
  const padding = (maxVal - minVal) * 0.08 || 0.0002;
  const lo      = minVal - padding;
  const hi      = maxVal + padding;
  const range   = hi - lo || 1;

  const toX = (i) => PAD.left + (i / (equityCurve.length - 1)) * cW;
  const toY = (v) => PAD.top  + (1 - (v - lo) / range) * cH;

  // ── Zero line (dashed, mid-brightness) ─────────────────────────────────────
  const zeroY = toY(0);
  if (zeroY >= PAD.top && zeroY <= PAD.top + cH) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(148,163,184,0.4)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([6, 4]);
    ctx.moveTo(PAD.left, zeroY);
    ctx.lineTo(PAD.left + cW, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(148,163,184,0.45)';
    ctx.font      = '9px "Fira Code", monospace';
    ctx.fillText('0', PAD.left - 22, zeroY + 3.5);
  }

  // ── Y-axis labels (top and bottom) ─────────────────────────────────────────
  ctx.fillStyle = 'rgba(148,163,184,0.55)';
  ctx.font      = '9px "Fira Code", monospace';
  ctx.fillText(maxVal.toFixed(4), 2, PAD.top + 9);
  ctx.fillText(minVal.toFixed(4), 2, PAD.top + cH);

  // ── Fill above zero (green alpha) ──────────────────────────────────────────
  const clampedZeroY = Math.max(PAD.top, Math.min(PAD.top + cH, zeroY));

  // Build path for fill above zero
  ctx.beginPath();
  equityCurve.forEach((v, i) => {
    const x = toX(i);
    const y = Math.max(PAD.top, toY(v));
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  });
  ctx.lineTo(toX(equityCurve.length - 1), clampedZeroY);
  ctx.lineTo(toX(0), clampedZeroY);
  ctx.closePath();
  const gradGreen = ctx.createLinearGradient(0, PAD.top, 0, clampedZeroY + 1);
  gradGreen.addColorStop(0,   'rgba(0,230,118,0.22)');
  gradGreen.addColorStop(1,   'rgba(0,230,118,0.02)');
  ctx.fillStyle = gradGreen;
  ctx.fill();

  // Build path for fill below zero
  ctx.beginPath();
  equityCurve.forEach((v, i) => {
    const x = toX(i);
    const y = Math.min(PAD.top + cH, toY(v));
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  });
  ctx.lineTo(toX(equityCurve.length - 1), clampedZeroY);
  ctx.lineTo(toX(0), clampedZeroY);
  ctx.closePath();
  const gradRed = ctx.createLinearGradient(0, clampedZeroY, 0, PAD.top + cH);
  gradRed.addColorStop(0,   'rgba(255,23,68,0.03)');
  gradRed.addColorStop(1,   'rgba(255,23,68,0.22)');
  ctx.fillStyle = gradRed;
  ctx.fill();

  // ── Equity line ─────────────────────────────────────────────────────────────
  const lastVal = equityCurve[equityCurve.length - 1];
  const lineColor = lastVal >= 0 ? '#00e676' : '#ff1744';

  ctx.beginPath();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth   = 1.75;
  ctx.lineJoin    = 'round';
  equityCurve.forEach((v, i) => {
    const x = toX(i);
    const y = Math.max(PAD.top, Math.min(PAD.top + cH, toY(v)));
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Endpoint dot
  const endX = toX(equityCurve.length - 1);
  const endY = Math.max(PAD.top, Math.min(PAD.top + cH, toY(lastVal)));
  ctx.beginPath();
  ctx.arc(endX, endY, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.shadowColor = lineColor;
  ctx.shadowBlur  = 8;
  ctx.fill();
  ctx.shadowBlur  = 0;
}

// ─── Stat card component ──────────────────────────────────────────────────────
function StatCard({ label, value, color, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value" style={{ color }}>
        {value}
      </div>
      {sub && (
        <div style={{
          fontSize: '0.6rem',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Simulation({ loggerStatus }) {
  const [backtestState,   setBacktestState]   = useState('idle');   // idle | running | complete | error
  const [backtestResults, setBacktestResults] = useState(null);
  const [errorMsg,        setErrorMsg]        = useState('');

  const equityCanvasRef = useRef(null);
  const isRunning       = backtestState === 'running';

  // ── Draw equity curve whenever results arrive ────────────────────────────────
  useEffect(() => {
    if (backtestState === 'complete' && backtestResults?.equityCurve) {
      // Defer one frame so the canvas has been mounted and sized by the browser
      const raf = requestAnimationFrame(() => {
        drawEquityCurve(equityCanvasRef.current, backtestResults.equityCurve);
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [backtestState, backtestResults]);

  // ── Redraw on window resize ──────────────────────────────────────────────────
  useEffect(() => {
    if (backtestState !== 'complete' || !backtestResults?.equityCurve) return;
    const handler = () =>
      drawEquityCurve(equityCanvasRef.current, backtestResults.equityCurve);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [backtestState, backtestResults]);

  // ── Run backtest ─────────────────────────────────────────────────────────────
  const handleRunBacktest = async () => {
    setBacktestState('running');
    setErrorMsg('');
    setBacktestResults(null);

    try {
      const res = await fetch(getApiBase() + '/api/backtest/run');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server responded with HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      setBacktestResults(data);
      setBacktestState('complete');
    } catch (err) {
      setErrorMsg(err.message || 'Unknown error during backtest.');
      setBacktestState('error');
    }
  };

  // ── Derived display values ───────────────────────────────────────────────────
  const rowCount    = loggerStatus?.rowCount    ?? 0;
  const fileSizeKB  = loggerStatus?.fileSizeKB  ?? 0;
  const isRecording = loggerStatus?.enabled     ?? false;
  const fileName    = loggerStatus?.fileName    ?? '—';

  const fileSizeDisplay =
    fileSizeKB >= 1024
      ? `${(fileSizeKB / 1024).toFixed(2)} MB`
      : `${fileSizeKB.toFixed(1)} KB`;

  const r = backtestResults;

  const pnlColor =
    r?.totalPnl > 0
      ? 'var(--color-bid)'
      : r?.totalPnl < 0
      ? 'var(--color-ask)'
      : 'var(--text-secondary)';

  const winRateColor =
    r?.winRate >= 50 ? 'var(--color-bid)' : 'var(--color-ask)';

  const sharpeColor =
    r?.sharpe >= 1
      ? 'var(--color-bid)'
      : r?.sharpe >= 0
      ? 'var(--color-spread)'
      : 'var(--color-ask)';

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="simulation-layout">

      {/* ── 1. DATA LOGGER STATUS ─────────────────────────────────────────────── */}
      <div className="glass-panel" style={{ padding: '16px' }}>
        <div className="panel-title">
          <span>DATA LOGGER STATUS</span>
          <span className="panel-subtitle">tick-level market data capture</span>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '12px',
          marginTop: '8px',
        }}>
          {/* Ticks logged */}
          <div className="stat-card">
            <div className="stat-card-label">TICKS LOGGED</div>
            <div
              className="stat-card-value"
              style={{ color: 'var(--color-cyan)' }}
            >
              {rowCount.toLocaleString()}
            </div>
            <div style={{
              fontSize: '0.6rem',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}>
              rows in today's file
            </div>
          </div>

          {/* File size */}
          <div className="stat-card">
            <div className="stat-card-label">FILE SIZE</div>
            <div
              className="stat-card-value"
              style={{ color: 'var(--text-secondary)' }}
            >
              {fileSizeDisplay}
            </div>
            <div style={{
              fontSize: '0.6rem',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}>
              on disk (append-only)
            </div>
          </div>

          {/* Status */}
          <div className="stat-card">
            <div className="stat-card-label">STATUS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
              <span
                className={`status-pulse ${isRecording ? 'active' : 'inactive'}`}
                style={{ flexShrink: 0 }}
              />
              <span
                className="stat-card-value"
                style={{
                  color: isRecording ? 'var(--color-bid)' : 'var(--color-spread)',
                  fontSize: '0.95rem',
                }}
              >
                {isRecording ? 'RECORDING' : 'PAUSED'}
              </span>
            </div>
          </div>

          {/* File name */}
          <div className="stat-card">
            <div className="stat-card-label">FILE NAME</div>
            <div style={{
              fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
              wordBreak: 'break-all',
              lineHeight: 1.4,
              marginTop: '4px',
            }}>
              {fileName}
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. BACKTEST ENGINE ───────────────────────────────────────────────── */}
      <div className="glass-panel" style={{ padding: '20px' }}>
        <div className="panel-title">
          <span>BACKTEST ENGINE</span>
          <span className="panel-subtitle">replay logged ticks through live strategy</span>
        </div>

        {/* Strategy description */}
        <div style={{
          background: 'rgba(0,229,255,0.04)',
          border: '1px solid rgba(0,229,255,0.12)',
          borderRadius: '8px',
          padding: '14px 16px',
          margin: '12px 0 16px',
        }}>
          <div style={{
            fontSize: '0.7rem',
            color: 'var(--color-cyan)',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            letterSpacing: '0.5px',
            marginBottom: '6px',
          }}>
            COMPOSITE SIGNAL — MULTI-FACTOR STRATEGY
          </div>
          <p style={{
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            fontFamily: 'var(--font-sans)',
            margin: 0,
          }}>
            Replays up to <strong style={{ color: 'var(--text-primary)' }}>5,000 logged ticks</strong> using
            the identical multi-signal composite strategy. Signal&nbsp;=&nbsp;
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-cyan)', fontSize: '0.78rem' }}>
              0.30×OBI + 0.25×OFI + 0.20×TI + 0.15×MCP_SKEW + 0.10×DWI
            </span>
            {' '}with volatility regime scaling. Uses realistic Binance taker
            fees <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>(0.04%)</span>.
          </p>
        </div>

        {/* Run button + state */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <button
            className="btn"
            disabled={isRunning || !rowCount}
            onClick={handleRunBacktest}
            style={{
              background: isRunning || !rowCount
                ? 'var(--text-muted)'
                : 'var(--color-cyan)',
              color: isRunning || !rowCount
                ? 'var(--bg-primary)'
                : '#000',
              boxShadow: !isRunning && rowCount
                ? 'var(--glow-shadow-cyan)'
                : 'none',
              cursor: isRunning || !rowCount ? 'not-allowed' : 'pointer',
              transform: 'none',
              minWidth: '160px',
              letterSpacing: '1px',
            }}
          >
            {isRunning ? 'RUNNING…' : 'RUN BACKTEST'}
          </button>

          {isRunning && (
            <span style={{
              fontSize: '0.78rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
            }}>
              Replaying ticks — this takes a few seconds
            </span>
          )}

          {backtestState === 'complete' && r && (
            <span style={{
              fontSize: '0.78rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-bid)',
            }}>
              {r.ticksReplayed?.toLocaleString()} ticks replayed — {r.totalTrades} trades
            </span>
          )}

          {!rowCount && backtestState !== 'running' && (
            <span style={{
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}>
              Start the engine and wait for ticks to accumulate…
            </span>
          )}
        </div>

        {/* Error state */}
        {backtestState === 'error' && errorMsg && (
          <div style={{
            marginTop: '14px',
            background: 'rgba(255,23,68,0.08)',
            border: '1px solid rgba(255,23,68,0.3)',
            borderRadius: '6px',
            padding: '12px 14px',
            fontSize: '0.8rem',
            color: 'var(--color-ask)',
            fontFamily: 'var(--font-mono)',
            lineHeight: 1.5,
          }}>
            <strong style={{ display: 'block', marginBottom: '4px' }}>BACKTEST FAILED</strong>
            {errorMsg}
          </div>
        )}
      </div>

      {/* ── 3. RESULTS — shown only when complete ────────────────────────────── */}
      {backtestState === 'complete' && r && (
        <>
          {/* 3a. Summary stat grid */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <div className="panel-title">
              <span>BACKTEST RESULTS</span>
              <span className="panel-subtitle">{r.summary}</span>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '12px',
              marginTop: '8px',
            }}>
              <StatCard
                label="TOTAL P&L"
                value={`${r.totalPnl >= 0 ? '+' : ''}${r.totalPnl?.toFixed(4)} USDT`}
                color={pnlColor}
                sub={`avg ${r.avgTradePnl?.toFixed(6)} / trade`}
              />
              <StatCard
                label="WIN RATE"
                value={`${r.winRate?.toFixed(1)}%`}
                color={winRateColor}
                sub={`${r.winCount}W / ${r.lossCount}L`}
              />
              <StatCard
                label="SHARPE RATIO"
                value={r.sharpe?.toFixed(3)}
                color={sharpeColor}
                sub="annualised"
              />
              <StatCard
                label="MAX DRAWDOWN"
                value={`${r.maxDrawdown?.toFixed(4)}`}
                color="var(--color-ask)"
                sub="peak-to-trough USDT"
              />
              <StatCard
                label="TOTAL TRADES"
                value={r.totalTrades?.toLocaleString()}
                color="var(--color-cyan)"
                sub={`from ${r.ticksReplayed?.toLocaleString()} ticks`}
              />
            </div>
          </div>

          {/* 3b. Equity curve canvas */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <div className="panel-title">
              <span>EQUITY CURVE</span>
              <span className="panel-subtitle">cumulative P&amp;L over replay window</span>
            </div>
            <canvas
              ref={equityCanvasRef}
              style={{
                display: 'block',
                width: '100%',
                height: '180px',
                marginTop: '8px',
                borderRadius: '4px',
              }}
            />
          </div>

          {/* 3c. Recent trades table */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <div className="panel-title">
              <span>RECENT TRADES</span>
              <span className="panel-subtitle">
                last {Math.min(r.recentTrades?.length ?? 0, 50)} trades (newest first)
              </span>
            </div>
            <div style={{
              maxHeight: '300px',
              overflowY: 'auto',
              marginTop: '8px',
            }}>
              {r.recentTrades && r.recentTrades.length > 0 ? (
                <table className="trade-history-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>DIRECTION</th>
                      <th>ENTRY</th>
                      <th>EXIT</th>
                      <th>P&amp;L (USDT)</th>
                      <th>REASON</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.recentTrades.map((trade) => {
                      const pnlPositive = trade.pnl > 0;
                      return (
                        <tr key={trade.id}>
                          <td style={{ color: 'var(--text-muted)' }}>
                            {trade.id}
                          </td>
                          <td style={{
                            color: trade.direction === 'LONG'
                              ? 'var(--color-bid)'
                              : 'var(--color-ask)',
                            fontWeight: 600,
                          }}>
                            {trade.direction?.toUpperCase()}
                          </td>
                          <td>{trade.entry?.toFixed(2)}</td>
                          <td>{trade.exit?.toFixed(2)}</td>
                          <td style={{
                            color: pnlPositive
                              ? 'var(--color-bid)'
                              : 'var(--color-ask)',
                            fontWeight: 600,
                          }}>
                            {pnlPositive ? '+' : ''}
                            {trade.pnl?.toFixed(6)}
                          </td>
                          <td style={{
                            color: trade.reason === 'tp'
                              ? 'var(--color-bid)'
                              : trade.reason === 'stop'
                              ? 'var(--color-ask)'
                              : 'var(--text-muted)',
                          }}>
                            {trade.reason?.toUpperCase().replace('_', ' ')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div style={{
                  textAlign: 'center',
                  padding: '32px',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                }}>
                  No trades were generated in this replay window.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
