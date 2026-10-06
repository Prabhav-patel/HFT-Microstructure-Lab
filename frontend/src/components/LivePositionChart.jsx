import { useRef, useEffect, useState, useCallback, useMemo } from 'react';

/**
 * Live BTC price with position overlay and per-factor attribution on hover.
 *
 * The purpose is to make a trade explainable at the moment you look at it.
 * A price line alone tells you what happened; shading the periods where a
 * position was open tells you what the strategy did; and the hover breakdown
 * tells you WHICH microstructure feature drove the decision, so a losing trade
 * points at the factor to distrust rather than at the strategy as a whole.
 *
 * The contributions shown are weight x clip(value) x volScale and sum exactly
 * to the signal, so the attribution reconciles rather than merely looking
 * plausible.
 */

const FACTOR_META = {
  obi: { label: 'Order Book Imbalance', hint: 'resting size, bid vs ask' },
  ofi: { label: 'Order Flow Imbalance', hint: 'net pressure at the touch' },
  ti:  { label: 'Trade Imbalance',      hint: 'aggressive buys vs sells' },
  mcp: { label: 'Micro-Price Skew',     hint: 'size-weighted fair value' },
  dwi: { label: 'Depth-Weighted Imb.',  hint: 'imbalance across 5 levels' },
};

// Must match FACTOR_ORDER in backend/papertrader.js. The tape ships
// contributions as a packed fixed-order array to keep the websocket payload
// small, so a mismatch here would mislabel every factor without erroring.
const FACTOR_ORDER = ['obi', 'ofi', 'ti', 'mcp', 'dwi'];

const COLOR_BID = '#00e676';
const COLOR_ASK = '#ff1744';
const COLOR_CYAN = '#22d3ee';

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function LivePositionChart({ paperState, threshold = 0.28, height = 260 }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);
  const geomRef = useRef(null);

  const tape = useMemo(() => paperState?.priceTape ?? [], [paperState?.priceTape]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = rect.width;
    const H = height;
    const pad = { top: 14, bottom: 22, left: 8, right: 62 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 6);
    ctx.fill();

    if (tape.length < 2) {
      ctx.fillStyle = 'rgba(148,163,184,0.35)';
      ctx.font = '12px "Fira Code", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for price data…', W / 2, H / 2);
      geomRef.current = null;
      return;
    }

    const prices = tape.map((p) => p.mid);
    let min = Math.min(...prices);
    let max = Math.max(...prices);
    // A flat window would divide by zero; give it a token band so the line
    // renders through the middle instead of collapsing.
    if (max - min < 1e-9) { min -= 1; max += 1; }
    const padRange = (max - min) * 0.12;
    min -= padRange;
    max += padRange;
    const range = max - min;

    const toX = (i) => pad.left + (i / (tape.length - 1)) * plotW;
    const toY = (v) => pad.top + (1 - (v - min) / range) * plotH;

    geomRef.current = { toX, toY, pad, plotW, plotH, min, max, W, H };

    // grid
    for (let i = 0; i <= 3; i++) {
      const y = pad.top + (i / 3) * plotH;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(W - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(148,163,184,0.5)';
      ctx.font = '9px "Fira Code", monospace';
      ctx.textAlign = 'left';
      ctx.fillText((max - (i / 3) * range).toFixed(1), W - pad.right + 6, y + 3);
    }

    // Position shading: contiguous runs where a position was open. This is the
    // single most useful overlay — it shows at a glance whether the strategy
    // was in the market during a move or watching it go past.
    let runStart = null;
    for (let i = 0; i <= tape.length; i++) {
      const pos = i < tape.length ? tape[i].pos : 0;
      if (pos !== 0 && runStart === null) runStart = i;
      if ((pos === 0 || i === tape.length) && runStart !== null) {
        const dir = tape[runStart].pos;
        const x0 = toX(runStart);
        const x1 = toX(Math.max(i - 1, runStart));
        ctx.fillStyle = dir > 0 ? 'rgba(0,230,118,0.10)' : 'rgba(255,23,68,0.10)';
        ctx.fillRect(x0, pad.top, Math.max(x1 - x0, 1.5), plotH);
        runStart = null;
      }
    }

    // price line
    ctx.beginPath();
    tape.forEach((p, i) => {
      const x = toX(i);
      const y = toY(p.mid);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = COLOR_CYAN;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // entry / exit markers at position transitions
    for (let i = 1; i < tape.length; i++) {
      const prev = tape[i - 1].pos;
      const cur = tape[i].pos;
      if (prev === cur) continue;
      const x = toX(i);
      const y = toY(tape[i].mid);

      if (cur !== 0) {
        // opened: triangle pointing the way we bet
        ctx.fillStyle = cur > 0 ? COLOR_BID : COLOR_ASK;
        ctx.beginPath();
        if (cur > 0) {
          ctx.moveTo(x, y - 8); ctx.lineTo(x - 5, y + 2); ctx.lineTo(x + 5, y + 2);
        } else {
          ctx.moveTo(x, y + 8); ctx.lineTo(x - 5, y - 2); ctx.lineTo(x + 5, y - 2);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        // closed: hollow square
        ctx.strokeStyle = 'rgba(226,232,240,0.85)';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
      }
    }

    // hover crosshair
    if (hover && hover.index != null) {
      const x = toX(hover.index);
      const y = toY(tape[hover.index].mid);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = COLOR_CYAN;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // time axis ends
    ctx.fillStyle = 'rgba(148,163,184,0.5)';
    ctx.font = '9px "Fira Code", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(fmtTime(tape[0].ts), pad.left, H - 7);
    ctx.textAlign = 'right';
    ctx.fillText(fmtTime(tape[tape.length - 1].ts), W - pad.right, H - 7);
  }, [tape, hover, height]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [draw]);

  const onMove = (e) => {
    const g = geomRef.current;
    const canvas = canvasRef.current;
    if (!g || !canvas || tape.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frac = (x - g.pad.left) / g.plotW;
    const idx = Math.round(frac * (tape.length - 1));
    if (idx < 0 || idx >= tape.length) { setHover(null); return; }
    setHover({ index: idx, x, y: e.clientY - rect.top });
  };

  const point = hover && hover.index != null ? tape[hover.index] : null;
  const order = paperState?.factorOrder ?? FACTOR_ORDER;
  const comps = point
    ? (point.c ?? []).map((v, i) => ({ k: order[i] ?? String(i), c: v }))
    : [];
  const maxAbs = comps.reduce((m, c) => Math.max(m, Math.abs(c.c)), 0.0001);
  const fired = point ? Math.abs(point.signal) > threshold : false;

  return (
    <div className="glass-panel" style={{ padding: '16px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '12px', borderBottom: '1px solid var(--border-color)',
        paddingBottom: '8px', flexWrap: 'wrap', gap: '8px',
      }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontSize: '0.72rem',
          letterSpacing: '1.5px', color: 'var(--text-muted)',
        }}>BTC PRICE &amp; POSITIONS</span>
        <div style={{
          display: 'flex', gap: '14px', flexWrap: 'wrap',
          fontFamily: 'var(--font-mono)', fontSize: '0.63rem', color: 'var(--text-muted)',
        }}>
          <span><span style={{ color: COLOR_BID }}>▲</span> long entry</span>
          <span><span style={{ color: COLOR_ASK }}>▼</span> short entry</span>
          <span><span style={{ color: '#e2e8f0' }}>▫</span> exit</span>
          <span>shaded = position open</span>
          <span>{tape.length} pts</span>
        </div>
      </div>

      <div ref={wrapRef} style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: height + 'px', display: 'block',
                   borderRadius: '6px', cursor: 'crosshair' }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />

        {point && (
          <div style={{
            position: 'absolute',
            // Flip the tooltip to the left near the right edge so it is never
            // clipped by the panel.
            left: hover.x > 320 ? hover.x - 300 : hover.x + 16,
            top: 8,
            width: '286px',
            background: 'rgba(10,14,20,0.97)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px', padding: '10px 12px',
            pointerEvents: 'none', zIndex: 20,
            boxShadow: '0 8px 28px rgba(0,0,0,0.6)',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontFamily: 'var(--font-mono)', fontSize: '0.68rem',
              color: 'var(--text-secondary)', marginBottom: '6px',
            }}>
              <span>{fmtTime(point.ts)}</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                ${point.mid.toFixed(2)}
              </span>
            </div>

            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '5px 0', borderTop: '1px solid var(--border-color)',
              borderBottom: '1px solid var(--border-color)', marginBottom: '8px',
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.63rem',
                             color: 'var(--text-muted)' }}>
                SIGNAL
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 700,
                color: point.signal > 0 ? COLOR_BID : point.signal < 0 ? COLOR_ASK
                     : 'var(--text-secondary)',
              }}>
                {point.signal >= 0 ? '+' : ''}{point.signal.toFixed(4)}
              </span>
            </div>

            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.6rem',
              color: fired ? COLOR_CYAN : 'var(--text-muted)', marginBottom: '8px',
            }}>
              {point.pos !== 0
                ? `IN POSITION — ${point.pos > 0 ? 'LONG' : 'SHORT'}`
                : fired
                  ? `above ±${threshold} threshold`
                  : `below ±${threshold} threshold — no trade`}
            </div>

            <div style={{
              fontFamily: 'var(--font-display)', fontSize: '0.58rem',
              letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: '6px',
            }}>WHY — FACTOR CONTRIBUTIONS</div>

            {comps.map((c) => {
              const meta = FACTOR_META[c.k] ?? { label: c.k, hint: '' };
              const pctW = (Math.abs(c.c) / maxAbs) * 100;
              const pos = c.c >= 0;
              const isDom = c.k === point.dom;
              return (
                <div key={c.k} style={{ marginBottom: '5px' }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontFamily: 'var(--font-mono)', fontSize: '0.6rem',
                    color: isDom ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontWeight: isDom ? 700 : 400,
                  }}>
                    <span>{meta.label}{isDom ? ' ◄' : ''}</span>
                    <span style={{ color: pos ? COLOR_BID : COLOR_ASK }}>
                      {pos ? '+' : ''}{c.c.toFixed(4)}
                    </span>
                  </div>
                  {/* diverging bar from a centre line, so sign reads at a glance */}
                  <div style={{
                    position: 'relative', height: '5px', marginTop: '2px',
                    background: 'rgba(255,255,255,0.05)', borderRadius: '2px',
                  }}>
                    <div style={{
                      position: 'absolute', left: '50%', top: 0, bottom: 0,
                      width: '1px', background: 'rgba(255,255,255,0.18)',
                    }} />
                    <div style={{
                      position: 'absolute', top: 0, bottom: 0,
                      left: pos ? '50%' : (50 - pctW / 2) + '%',
                      width: (pctW / 2) + '%',
                      background: pos ? COLOR_BID : COLOR_ASK,
                      opacity: isDom ? 0.95 : 0.5, borderRadius: '2px',
                    }} />
                  </div>
                </div>
              );
            })}

            {point.dom && FACTOR_META[point.dom] && (
              <div style={{
                marginTop: '8px', paddingTop: '6px',
                borderTop: '1px solid var(--border-color)',
                fontFamily: 'var(--font-mono)', fontSize: '0.58rem',
                color: 'var(--text-muted)', lineHeight: 1.5,
              }}>
                Driven by <strong style={{ color: COLOR_CYAN }}>
                {FACTOR_META[point.dom].label}</strong> — {FACTOR_META[point.dom].hint}.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
