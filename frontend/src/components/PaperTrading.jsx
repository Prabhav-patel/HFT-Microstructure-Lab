import { useRef, useEffect, useCallback } from 'react';
import LivePositionChart from './LivePositionChart';

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(n, dec = 2) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(dec);
}

function fmtDollar(n) {
  if (n === null || n === undefined || isNaN(n)) return '$—';
  const abs = Math.abs(n);
  return (n < 0 ? '-$' : '+$') + abs.toFixed(2);
}

function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return fmt(n, 1) + '%';
}

function dirColor(dir) {
  if (dir === 'LONG' || dir > 0) return 'var(--color-bid)';
  if (dir === 'SHORT' || dir < 0) return 'var(--color-ask)';
  return 'var(--text-muted)';
}

function signalColor(v) {
  if (v > 0.01) return 'var(--color-bid)';
  if (v < -0.01) return 'var(--color-ask)';
  return 'var(--text-secondary)';
}

function pnlColor(v) {
  if (v > 0) return 'var(--color-bid)';
  if (v < 0) return 'var(--color-ask)';
  return 'var(--text-secondary)';
}

// ─── sub-components ─────────────────────────────────────────────────────────

function CardTitle({ children }) {
  return (
    <div style={{
      fontFamily: 'var(--font-display)',
      fontSize: '0.68rem',
      letterSpacing: '1.5px',
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      borderBottom: '1px solid var(--border-color)',
      paddingBottom: '8px',
      marginBottom: '10px',
    }}>
      {children}
    </div>
  );
}

function MiniLabel({ children }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)',
      fontSize: '0.6rem',
      color: 'var(--text-muted)',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }}>
      {children}
    </span>
  );
}

function DisplayValue({ value, color, size = '2rem' }) {
  return (
    <span style={{
      fontFamily: 'var(--font-display)',
      fontSize: size,
      fontWeight: 700,
      color: color || 'var(--text-primary)',
      letterSpacing: '-0.5px',
      lineHeight: 1,
    }}>
      {value}
    </span>
  );
}

function StatBox({ label, value, valueColor }) {
  return (
    <div style={{
      background: 'rgba(0,0,0,0.2)',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      padding: '8px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      textAlign: 'center',
    }}>
      <MiniLabel>{label}</MiniLabel>
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: '1.05rem',
        fontWeight: 700,
        color: valueColor || 'var(--text-primary)',
      }}>
        {value}
      </span>
    </div>
  );
}

// ─── signal history canvas ───────────────────────────────────────────────────

function useSignalCanvas(canvasRef, signalHistory = [], threshold = 0.28) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const midY = H / 2;

    // Background
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 4);
    ctx.fill();

    if (!signalHistory.length) return;

    const barW = Math.max(2, W / Math.max(signalHistory.length, 40));
    const scale = midY / 1.0; // 1.0 = full range

    signalHistory.forEach((val, i) => {
      const x = i * barW;
      const clamp = Math.max(-1, Math.min(1, val));
      const barH = Math.abs(clamp) * scale;
      const isPos = clamp >= 0;

      ctx.fillStyle = isPos
        ? 'rgba(0, 230, 118, 0.75)'
        : 'rgba(255, 23, 68, 0.75)';

      ctx.fillRect(
        x,
        isPos ? midY - barH : midY,
        barW - 1,
        barH
      );
    });

    // Zero line
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(W, midY);
    ctx.stroke();

    // Threshold lines ±0.28
    const thY = threshold * scale;
    [midY - thY, midY + thY].forEach((y) => {
      ctx.strokeStyle = 'rgba(255, 179, 0, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }, [canvasRef, signalHistory, threshold]);
}

// ─── equity curve canvas ─────────────────────────────────────────────────────

function useEquityCanvas(canvasRef, equityCurve = []) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;

    // Background fill
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 6);
    ctx.fill();

    // Subtle CRT scan-line texture — the aesthetic risk, drawn once per frame
    for (let y = 0; y < H; y += 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, y, W, 1);
    }

    if (!equityCurve.length) {
      ctx.fillStyle = 'rgba(148,163,184,0.3)';
      ctx.font = '11px "Fira Code", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Awaiting trade history…', W / 2, H / 2);
      return;
    }

    const min = Math.min(...equityCurve);
    const max = Math.max(...equityCurve);
    const range = max - min || 1;
    const pad = { top: 12, bottom: 12, left: 2, right: 2 };
    const drawH = H - pad.top - pad.bottom;
    const drawW = W - pad.left - pad.right;

    const toX = (i) => pad.left + (i / (equityCurve.length - 1 || 1)) * drawW;
    const toY = (v) => pad.top + (1 - (v - min) / range) * drawH;

    // Horizontal grid lines (4)
    for (let i = 0; i <= 3; i++) {
      const y = pad.top + (i / 3) * drawH;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(W - pad.right, y);
      ctx.stroke();
    }

    // Zero line (dashed) — only if min < 0 < max
    if (min < 0 && max > 0) {
      const zeroY = toY(0);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, zeroY);
      ctx.lineTo(W - pad.right, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Build path
    const lastVal = equityCurve[equityCurve.length - 1];
    const isPositive = lastVal >= 0;

    ctx.beginPath();
    equityCurve.forEach((v, i) => {
      const x = toX(i);
      const y = toY(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });

    // Area fill under curve
    const zeroClampY = min < 0 && max > 0 ? toY(0) : (isPositive ? H - pad.bottom : pad.top);
    ctx.lineTo(toX(equityCurve.length - 1), zeroClampY);
    ctx.lineTo(toX(0), zeroClampY);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    if (isPositive) {
      grad.addColorStop(0, 'rgba(0,230,118,0.28)');
      grad.addColorStop(1, 'rgba(0,230,118,0.02)');
    } else {
      grad.addColorStop(0, 'rgba(255,23,68,0.02)');
      grad.addColorStop(1, 'rgba(255,23,68,0.28)');
    }
    ctx.fillStyle = grad;
    ctx.fill();

    // Curve line
    ctx.beginPath();
    equityCurve.forEach((v, i) => {
      const x = toX(i);
      const y = toY(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = isPositive ? 'var(--color-bid)' : 'var(--color-ask)';

    // Override with literal color since canvas strokeStyle can't read CSS vars at paint time
    ctx.strokeStyle = isPositive ? '#00e676' : '#ff1744';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Terminal glow dot at last point
    const lx = toX(equityCurve.length - 1);
    const ly = toY(lastVal);
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = isPositive ? '#00e676' : '#ff1744';
    ctx.fill();

    // Scan lines again on top for CRT feel
    for (let y = 0; y < H; y += 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(0, y, W, 1);
    }
  }, [canvasRef, equityCurve]);
}

// ─── main component ──────────────────────────────────────────────────────────

/**
 * Performance metrics.
 *
 * The layout deliberately separates three questions that a single "win rate"
 * conflates:
 *
 *   DIRECTION  did price move the way we predicted?
 *   GROSS      did the trade make money before costs?
 *   NET        did it make money after costs?
 *
 * When the round-trip cost exceeds the typical price move over the holding
 * window, net win rate sits near zero even though direction is healthy.
 * Showing only the net number makes a working signal look broken, which is
 * exactly the confusion this panel exists to remove.
 */
function MetricsPanel({ metrics, costs, grossPnl, feesPaid, onSetFee }) {
  if (!metrics) return null;

  const pct = (v) => (v == null ? '--' : v.toFixed(1) + '%');
  const bps = (v) => (v == null ? '--' : v.toFixed(2));
  const usd = (v) => (v == null ? '--' : (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(4));

  const accColor = (v) =>
    v >= 55 ? 'var(--color-bid)' : v >= 45 ? '#e0b341' : 'var(--color-ask)';

  const insufficient = metrics.sampleQuality === 'insufficient';

  const Cell = ({ label, value, color, hint }) => (
    <div style={{
      background: 'rgba(0,0,0,0.22)', border: '1px solid var(--border-color)',
      borderRadius: '6px', padding: '10px 12px', minWidth: 0,
    }}>
      <div style={{
        fontFamily: 'var(--font-display)', fontSize: '0.6rem', letterSpacing: '1px',
        color: 'var(--text-muted)', marginBottom: '5px', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '1.05rem', fontWeight: 700,
        color: color || 'var(--text-primary)', fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
      {hint && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.6rem',
          color: 'var(--text-muted)', marginTop: '3px',
        }}>{hint}</div>
      )}
    </div>
  );

  const Section = ({ title, note, children }) => (
    <div style={{ marginBottom: '14px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: '8px', flexWrap: 'wrap', gap: '8px',
      }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontSize: '0.68rem',
          letterSpacing: '1.5px', color: 'var(--color-cyan)',
        }}>{title}</span>
        {note && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.62rem',
            color: 'var(--text-muted)',
          }}>{note}</span>
        )}
      </div>
      <div style={{
        display: 'grid', gap: '8px',
        gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
      }}>{children}</div>
    </div>
  );

  return (
    <div className="glass-panel" style={{ padding: '16px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '14px', borderBottom: '1px solid var(--border-color)',
        paddingBottom: '8px', flexWrap: 'wrap', gap: '8px',
      }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontSize: '0.72rem',
          letterSpacing: '1.5px', color: 'var(--text-muted)',
        }}>PERFORMANCE METRICS</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--text-muted)',
          }}>{metrics.totalTrades} closed trades</span>
          {costs && onSetFee && (
            <div style={{ display: 'flex', gap: '6px' }}>
              {[
                { label: 'REAL FEE', rate: costs.liveFeeRate, active: costs.feeModel === 'live' },
                { label: 'ZERO FEE', rate: 0, active: costs.feeModel === 'zero' },
              ].map((o) => (
                <button
                  key={o.label}
                  onClick={() => onSetFee(o.rate)}
                  title="Changing the fee restarts the session"
                  style={{
                    fontFamily: 'var(--font-display)', fontSize: '0.6rem',
                    letterSpacing: '1px', padding: '4px 10px', borderRadius: '4px',
                    cursor: 'pointer', whiteSpace: 'nowrap',
                    border: '1px solid ' + (o.active ? 'var(--color-cyan)' : 'var(--border-color)'),
                    background: o.active ? 'rgba(94,200,190,0.15)' : 'transparent',
                    color: o.active ? 'var(--color-cyan)' : 'var(--text-muted)',
                  }}
                >{o.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <Section title="PREDICTION QUALITY" note="direction judged mid-to-mid, before any cost">
        <Cell label="DIRECTIONAL ACCURACY" value={pct(metrics.directionalAccuracy)}
              color={accColor(metrics.directionalAccuracy)} hint="50% = coin flip" />
        <Cell label="GROSS WIN RATE" value={pct(metrics.grossWinRate)}
              color={accColor(metrics.grossWinRate)} hint="profitable before fees" />
        <Cell label="NET WIN RATE" value={pct(metrics.netWinRate)}
              color={accColor(metrics.netWinRate)} hint="profitable after fees" />
        <Cell label="LONG PRECISION" value={pct(metrics.longPrecision)}
              hint={metrics.longTrades + ' long trades'} />
        <Cell label="SHORT PRECISION" value={pct(metrics.shortPrecision)}
              hint={metrics.shortTrades + ' short trades'} />
      </Section>

      {costs && costs.feeModel === 'zero' && (
        <div style={{
          background: 'rgba(94, 200, 190, 0.08)',
          border: '1px solid rgba(94, 200, 190, 0.35)',
          borderRadius: '6px', padding: '10px 12px', marginBottom: '14px',
          fontFamily: 'var(--font-mono)', fontSize: '0.68rem',
          color: 'var(--text-secondary)', lineHeight: 1.55,
        }}>
          <strong style={{ color: 'var(--color-cyan)' }}>ZERO-FEE DIAGNOSTIC MODE.</strong>{' '}
          Fees are switched off to isolate signal quality. These numbers are not
          achievable — the real tier is{' '}
          {(costs.liveFeeRate * 100).toFixed(3)}% per side
          ({(costs.liveFeeRate * 2 * 1e4).toFixed(2)} bps round trip).
        </div>
      )}

      {costs && (
        <Section title="COST STRUCTURE"
                 note={'must clear ' + bps(costs.hurdleBps) + ' bps to win'}>
          <Cell label="FEE (ROUND TRIP)" value={bps(costs.feeBpsRoundTrip) + ' bps'}
                color={costs.feeModel === 'zero' ? 'var(--color-cyan)' : 'var(--color-ask)'}
                hint={(costs.feeRatePerSide * 100).toFixed(3) + '% per side'
                      + (costs.feeModel === 'zero' ? ' (diagnostic)' : '')} />
          <Cell label="SPREAD" value={bps(costs.spreadBps) + ' bps'}
                hint="paid entry and exit" />
          <Cell label="TOTAL HURDLE" value={bps(costs.hurdleBps) + ' bps'}
                color="var(--color-ask)" hint="fee + spread" />
          <Cell label="GROSS EDGE" value={bps(metrics.grossBps) + ' bps'}
                color={metrics.grossBps >= 0 ? 'var(--color-bid)' : 'var(--color-ask)'}
                hint="captured before costs" />
          <Cell label="NET EDGE" value={bps(metrics.netBps) + ' bps'}
                color={metrics.netBps >= 0 ? 'var(--color-bid)' : 'var(--color-ask)'}
                hint="what you keep" />
        </Section>
      )}

      <Section title="P&amp;L BREAKDOWN" note="gross minus fees equals net">
        <Cell label="GROSS P&amp;L" value={usd(grossPnl)}
              color={grossPnl >= 0 ? 'var(--color-bid)' : 'var(--color-ask)'} />
        <Cell label="FEES PAID" value={usd(-feesPaid)} color="var(--color-ask)" />
        <Cell label="NET P&amp;L" value={usd(metrics.netPnl)}
              color={metrics.netPnl >= 0 ? 'var(--color-bid)' : 'var(--color-ask)'} />
        <Cell label="AVG TRADE" value={usd(metrics.avgTradePnl)}
              color={metrics.avgTradePnl >= 0 ? 'var(--color-bid)' : 'var(--color-ask)'} />
        <Cell label="PROFIT FACTOR"
              value={metrics.profitFactor === Infinity ? 'inf' : metrics.profitFactor.toFixed(2)}
              color={metrics.profitFactor >= 1 ? 'var(--color-bid)' : 'var(--color-ask)'}
              hint="wins / losses" />
      </Section>

      <Section title="RISK &amp; RETURN"
               note={insufficient
                 ? 'needs ' + metrics.equitySamplesNeeded + ' samples, have ' + metrics.equitySamples
                 : null}>
        <Cell label="SHARPE"
              value={metrics.sharpeReliable ? metrics.sharpe.toFixed(2) : 'n/a'}
              color={metrics.sharpeReliable
                ? (metrics.sharpe >= 0 ? 'var(--color-bid)' : 'var(--color-ask)')
                : 'var(--text-muted)'}
              hint={metrics.sharpeReliable ? 'annualised' : 'too few samples'} />
        <Cell label="VOLATILITY" value={pct(metrics.volatilityPct)} hint="annualised" />
        <Cell label="MAX DRAWDOWN" value={pct(metrics.maxDrawdownPct)}
              color="var(--color-ask)" hint={usd(metrics.maxDrawdown)} />
        <Cell label="ANNUALISED RETURN"
              value={metrics.annualisedReturnPct == null ? 'n/a' : pct(metrics.annualisedReturnPct)}
              color={metrics.annualisedReturnPct == null ? 'var(--text-muted)'
                : metrics.annualisedReturnPct >= 0 ? 'var(--color-bid)' : 'var(--color-ask)'}
              hint={metrics.annualisedReturnPct == null ? 'session too short' : 'extrapolated'} />
        <Cell label="RETURN" value={pct(metrics.returnPct)}
              color={metrics.returnPct >= 0 ? 'var(--color-bid)' : 'var(--color-ask)'}
              hint={costs ? 'on $' + costs.capital.toLocaleString() : null} />
      </Section>

      {metrics.totalTrades > 0 && metrics.netWinRate < 20
        && metrics.directionalAccuracy > 35 && costs && (
        <div style={{
          background: 'rgba(224, 179, 65, 0.08)',
          border: '1px solid rgba(224, 179, 65, 0.3)',
          borderRadius: '6px', padding: '10px 12px', marginTop: '4px',
          fontFamily: 'var(--font-mono)', fontSize: '0.68rem',
          color: 'var(--text-secondary)', lineHeight: 1.55,
        }}>
          <strong style={{ color: '#e0b341' }}>Why the net win rate is near zero.</strong>{' '}
          Direction is {pct(metrics.directionalAccuracy)} correct and gross edge is{' '}
          {bps(metrics.grossBps)} bps, but every round trip costs {bps(costs.hurdleBps)} bps.
          The signal is right far more often than the P&amp;L suggests — it captures
          less than it is charged. This is a cost problem, not a prediction problem.
        </div>
      )}
    </div>
  );
}

export default function PaperTrading({ paperState, onReset, onToggleKillSwitch, onSetFee }) {
  const signalCanvasRef = useRef(null);
  const equityCanvasRef = useRef(null);

  // Derived state from paperState (keys match papertrader.js getState() output)
  const position      = paperState?.position      ?? 0;
  const entryPrice    = paperState?.entryPrice     ?? null;
  const stopLoss      = paperState?.stopLoss       ?? null;
  const takeProfit    = paperState?.takeProfit     ?? null;
  const holdTicks     = paperState?.holdTicks      ?? 0;
  const signal        = paperState?.lastSignal     ?? 0;
  const signalHistory = paperState?.signalHistory  ?? [];
  const totalPnl      = paperState?.totalPnl       ?? 0;
  const realizedPnl   = paperState?.pnl            ?? 0;
  const unrealizedPnl = paperState?.unrealizedPnl  ?? 0;
  const dailyPnl      = paperState?.dailyPnl       ?? 0;
  const winRate       = paperState?.winRate        ?? 0;
  const tradeCount    = paperState?.totalTrades    ?? 0;
  const winCount      = paperState?.winCount       ?? 0;
  const lossCount     = paperState?.lossCount      ?? 0;
  const trades        = paperState?.trades         ?? [];
  const equityCurve   = paperState?.equityCurve    ?? [];
  const isActive      = paperState?.isActive       ?? true;
  const killReason    = paperState?.killSwitchReason ?? null;
  const metrics       = paperState?.metrics        ?? null;
  const costs         = paperState?.costs          ?? null;
  const grossPnl      = paperState?.grossPnl       ?? 0;
  const feesPaid      = paperState?.feesPaid       ?? 0;

  const positionLabel =
    position > 0 ? 'LONG' :
    position < 0 ? 'SHORT' :
    'FLAT';

  // Signal bar geometry
  const THRESHOLD = 0.28;
  const signalAbs = Math.min(Math.abs(signal), 1.5);
  const signalPct = (signalAbs / 1.5) * 50; // max 50% from center
  const isLong = signal > 0;

  useSignalCanvas(signalCanvasRef, signalHistory, THRESHOLD);
  useEquityCanvas(equityCanvasRef, equityCurve);

  // Resize observer to redraw on layout change
  const handleResize = useCallback(() => {
    // Trigger re-render to redraw canvases
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(handleResize);
    if (signalCanvasRef.current) observer.observe(signalCanvasRef.current);
    if (equityCanvasRef.current) observer.observe(equityCanvasRef.current);
    return () => observer.disconnect();
  }, [handleResize]);

  // ── empty state ──────────────────────────────────────────────────────────

  if (!paperState) {
    return (
      <div className="paper-trade-layout" style={{ justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
        <div className="glass-panel" style={{
          padding: '40px 60px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          alignItems: 'center',
          maxWidth: '480px',
          margin: '0 auto',
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            border: '2px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '8px',
          }}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path d="M11 4v7l4.5 2.5" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="11" cy="11" r="9" stroke="var(--text-muted)" strokeWidth="1.5"/>
            </svg>
          </div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', letterSpacing: '1px', color: 'var(--text-secondary)' }}>
            PAPER TRADING OFFLINE
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Start the engine to begin paper trading simulation.
          </span>
        </div>
      </div>
    );
  }

  // ── main render ──────────────────────────────────────────────────────────

  return (
    <div className="paper-trade-layout">

      {/* ── ROW 1: 4-COLUMN TOP CARDS ── */}
      <div className="paper-top-row">

        {/* 1. POSITION STATUS */}
        <div className="glass-panel paper-card">
          <CardTitle>Position Status</CardTitle>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <DisplayValue
              value={positionLabel}
              color={dirColor(position)}
              size={position !== 0 ? '1.9rem' : '2.4rem'}
            />
            {position !== 0 && (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
              }}>
                {fmt(Math.abs(position), 3)} BTC
              </span>
            )}
          </div>

          {position !== 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px',
              marginTop: '6px',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <MiniLabel>Entry</MiniLabel>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                  ${fmt(entryPrice, 2)}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <MiniLabel>Hold Ticks</MiniLabel>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: 'var(--color-spread)' }}>
                  {holdTicks}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <MiniLabel>Stop Loss</MiniLabel>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--color-ask)' }}>
                  ${fmt(stopLoss, 2)}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <MiniLabel>Take Profit</MiniLabel>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--color-bid)' }}>
                  ${fmt(takeProfit, 2)}
                </span>
              </div>
            </div>
          )}

          {position === 0 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              No open position. Waiting for entry signal.
            </span>
          )}
        </div>

        {/* 2. COMPOSITE SIGNAL */}
        <div className="glass-panel paper-card">
          <CardTitle>Composite Signal</CardTitle>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <DisplayValue
              value={(signal >= 0 ? '+' : '') + fmt(signal, 3)}
              color={signalColor(signal)}
              size="2rem"
            />
          </div>

          {/* Horizontal signal bar */}
          <div style={{ position: 'relative', height: '8px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'visible', marginTop: '8px' }}>
            {/* center divider */}
            <div style={{
              position: 'absolute',
              left: 'calc(50% - 1px)',
              top: '-2px',
              width: '2px',
              height: '12px',
              background: 'rgba(255,255,255,0.25)',
              borderRadius: '1px',
              zIndex: 2,
            }} />
            {/* fill bar */}
            {Math.abs(signal) > 0.005 && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: isLong ? '50%' : `calc(50% - ${signalPct}%)`,
                width: `${signalPct}%`,
                height: '100%',
                background: isLong ? '#00e676' : '#ff1744',
                borderRadius: '4px',
                transition: 'all 0.15s ease',
              }} />
            )}
          </div>

          {/* Signal history mini-canvas */}
          <div style={{ marginTop: '10px', position: 'relative' }}>
            <canvas
              ref={signalCanvasRef}
              height={60}
              style={{ width: '100%', height: '60px', display: 'block', borderRadius: '4px' }}
            />
          </div>

          <div style={{
            marginTop: '6px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.62rem',
            color: 'var(--text-muted)',
            display: 'flex',
            justifyContent: 'space-between',
          }}>
            <span style={{ color: 'rgba(255,179,0,0.7)' }}>— ±0.28 threshold</span>
            <span>Entry threshold: ±0.28</span>
          </div>
        </div>

        {/* 3. P&L SUMMARY */}
        <div className="glass-panel paper-card">
          <CardTitle>P&amp;L Summary</CardTitle>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <DisplayValue
              value={fmtDollar(totalPnl)}
              color={pnlColor(totalPnl)}
              size="1.85rem"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px' }}>
            <StatBox label="Realized" value={fmtDollar(realizedPnl)} valueColor={pnlColor(realizedPnl)} />
            <StatBox label="Unrealized" value={fmtDollar(unrealizedPnl)} valueColor={pnlColor(unrealizedPnl)} />
            <StatBox label="Daily P&L" value={fmtDollar(dailyPnl)} valueColor={pnlColor(dailyPnl)} />
            <StatBox label="Win Rate" value={fmtPct(winRate)} valueColor={winRate >= 50 ? 'var(--color-bid)' : 'var(--color-ask)'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginTop: '6px' }}>
            {[
              { label: 'TRADES', value: tradeCount, color: 'var(--color-cyan)' },
              { label: 'WINS', value: winCount, color: 'var(--color-bid)' },
              { label: 'LOSSES', value: lossCount, color: 'var(--color-ask)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                textAlign: 'center',
                padding: '6px 4px',
                background: 'rgba(0,0,0,0.15)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}>
                <MiniLabel>{label}</MiniLabel>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 700, color }}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 4. RISK MANAGEMENT */}
        <div
          className="glass-panel paper-card"
          style={{ border: !isActive ? '1px solid rgba(255,23,68,0.45)' : undefined }}
        >
          <CardTitle>Risk Management</CardTitle>

          {/* Strategy status badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '20px',
              background: isActive ? 'rgba(0,230,118,0.12)' : 'rgba(255,23,68,0.12)',
              border: `1px solid ${isActive ? 'rgba(0,230,118,0.3)' : 'rgba(255,23,68,0.3)'}`,
            }}>
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: isActive ? 'var(--color-bid)' : 'var(--color-ask)',
                boxShadow: isActive ? '0 0 6px rgba(0,230,118,0.5)' : '0 0 6px rgba(255,23,68,0.5)',
                animation: isActive ? 'pulse-green 1.5s infinite' : 'pulse-red 1.5s infinite',
              }} />
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: '0.72rem',
                fontWeight: 700,
                letterSpacing: '1px',
                color: isActive ? 'var(--color-bid)' : 'var(--color-ask)',
              }}>
                {isActive ? 'ACTIVE' : 'KILLED'}
              </span>
            </div>
          </div>

          {/* Kill reason */}
          {killReason && (
            <div style={{
              background: 'rgba(255,23,68,0.08)',
              border: '1px solid rgba(255,23,68,0.25)',
              borderRadius: '6px',
              padding: '6px 10px',
              marginBottom: '8px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.68rem',
              color: 'var(--color-ask)',
              lineHeight: 1.4,
            }}>
              {killReason}
            </div>
          )}

          {/* Risk params */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1 }}>
            {[
              { label: 'Position Size', value: '0.001 BTC' },
              { label: 'Stop Loss',     value: '4× spread' },
              { label: 'Take Profit',   value: '10× spread' },
              { label: 'Daily Limit',   value: '−$50.00' },
              { label: 'Max Hold',      value: '200 ticks' },
            ].map(({ label, value }) => (
              <div key={label} className="risk-param-row">
                <span className="risk-param-label">{label}</span>
                <span className="risk-param-value">{value}</span>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button
              onClick={onReset}
              style={{
                flex: 1,
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '0.68rem',
                letterSpacing: '1px',
                padding: '7px 8px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: 'var(--color-cyan)',
                color: '#000',
                boxShadow: 'var(--glow-shadow-cyan)',
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              RESET SESSION
            </button>

            {!isActive && (
              <button
                onClick={onToggleKillSwitch}
                style={{
                  flex: 1,
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '0.68rem',
                  letterSpacing: '1px',
                  padding: '7px 8px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  background: 'var(--color-spread)',
                  color: '#000',
                  boxShadow: '0 0 12px rgba(255,179,0,0.3)',
                  transition: 'opacity 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
              >
                REACTIVATE
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── ROW 1b: LIVE PRICE + POSITIONS ── */}
      <LivePositionChart paperState={paperState} threshold={THRESHOLD} />

      {/* ── ROW 2: EQUITY CURVE ── */}
      <div className="glass-panel" style={{ padding: '16px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '8px',
        }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.72rem', letterSpacing: '1.5px', color: 'var(--text-muted)' }}>
            EQUITY CURVE
          </span>
          <div style={{ display: 'flex', gap: '16px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              {equityCurve.length} samples
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.7rem',
              color: pnlColor(totalPnl),
            }}>
              Net: {fmtDollar(totalPnl)}
            </span>
          </div>
        </div>
        <canvas
          ref={equityCanvasRef}
          height={120}
          style={{ width: '100%', height: '120px', display: 'block', borderRadius: '4px' }}
        />
      </div>

      {/* ── ROW 2b: PERFORMANCE METRICS ── */}
      <MetricsPanel metrics={metrics} costs={costs}
                    grossPnl={grossPnl} feesPaid={feesPaid} onSetFee={onSetFee} />

      {/* ── ROW 3: TRADE HISTORY ── */}
      <div className="glass-panel" style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '180px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '8px',
        }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.72rem', letterSpacing: '1.5px', color: 'var(--text-muted)' }}>
            TRADE HISTORY
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            {trades.length} closed trades
          </span>
        </div>

        {trades.length === 0 ? (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: '8px',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
              No trades yet. Signal must exceed ±0.28 to enter a position.
            </span>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', flex: 1 }}>
            <table className="trade-history-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>DIR</th>
                  <th>ENTRY</th>
                  <th>EXIT</th>
                  <th>P&amp;L</th>
                  <th>REASON</th>
                </tr>
              </thead>
              <tbody>
                {[...trades].reverse().map((trade, idx) => {
                  const tradeNum = trades.length - idx;
                  const isLongTrade = trade.side === 'LONG';
                  const tradePnl = trade.pnl ?? 0;
                  return (
                    <tr key={`trade-${tradeNum}`}>
                      <td style={{ color: 'var(--text-muted)' }}>{tradeNum}</td>
                      <td style={{ color: isLongTrade ? 'var(--color-bid)' : 'var(--color-ask)', fontWeight: 600 }}>
                        {trade.side ?? '—'}
                      </td>
                      <td>${fmt(trade.entry, 2)}</td>
                      <td>${fmt(trade.exit, 2)}</td>
                      <td style={{ color: pnlColor(tradePnl), fontWeight: 600 }}>
                        {fmtDollar(tradePnl)}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                        {trade.reason || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
