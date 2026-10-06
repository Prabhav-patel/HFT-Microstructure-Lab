import { useEffect, useRef, useState } from 'react';

export default function MetricCard({ title, type, value, subText, rawData }) {
  const [valColor, setValColor] = useState('var(--text-primary)');
  const prevValRef = useRef(value);

  useEffect(() => {
    if (type === 'mid-price' && value !== undefined) {
      if (prevValRef.current !== undefined && value > prevValRef.current) {
        setValColor('var(--color-bid)');
        const timer = setTimeout(() => setValColor('var(--text-primary)'), 800);
        return () => clearTimeout(timer);
      } else if (prevValRef.current !== undefined && value < prevValRef.current) {
        setValColor('var(--color-ask)');
        const timer = setTimeout(() => setValColor('var(--text-primary)'), 800);
        return () => clearTimeout(timer);
      }
      prevValRef.current = value;
    }
  }, [value, type]);

  // Format Helper
  const formatVal = (val) => {
    if (val === undefined || val === null) return '-';
    if (typeof val === 'number') {
      return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return val;
  };

  if (type === 'bid-ask') {
    const bid = rawData?.best_bid || 0;
    const bidQty = rawData?.best_bid_qty || 0;
    const ask = rawData?.best_ask || 0;
    const askQty = rawData?.best_ask_qty || 0;

    return (
      <div className="glass-panel metric-card mid">
        <span className="metric-label">BEST BID / ASK</span>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px' }}>
          <div>
            <div style={{ color: 'var(--color-bid)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 'bold' }}>BID</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--color-bid)' }}>
              {formatVal(bid)}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Qty: {bidQty.toFixed(3)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: 'var(--color-ask)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 'bold' }}>ASK</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--color-ask)' }}>
              {formatVal(ask)}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Qty: {askQty.toFixed(3)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (type === 'imbalance') {
    const obi = rawData?.features?.obi?.value || 0; // Value is between -1 and 1
    // Map -1 to 1 into percentage (0% to 100%)
    const pct = ((obi + 1) / 2) * 100;
    const desc = obi > 0.05 ? 'Bid Pressure' : obi < -0.05 ? 'Ask Pressure' : 'Balanced';
    const descColor = obi > 0.05 ? 'var(--color-bid)' : obi < -0.05 ? 'var(--color-ask)' : 'var(--text-secondary)';

    return (
      <div className="glass-panel metric-card spread">
        <span className="metric-label">ORDER BOOK IMBALANCE</span>
        <div className="metric-value-container">
          <span className="metric-value" style={{ color: descColor, fontSize: '1.4rem' }}>
            {obi >= 0 ? '+' : ''}{obi.toFixed(4)}
          </span>
          <span className="metric-sub">{desc}</span>
        </div>
        <div className="metric-visual-bar" style={{ height: '8px', marginTop: '16px' }}>
          <div 
            style={{ 
              height: '100%', 
              width: '4px',
              backgroundColor: 'var(--text-primary)',
              position: 'absolute',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 3
            }}
          />
          <div 
            style={{ 
              height: '100%', 
              width: `${pct}%`, 
              backgroundColor: obi >= 0 ? 'var(--color-bid)' : 'var(--color-ask)',
              transition: 'width 0.2s ease, background-color 0.2s ease'
            }} 
          />
        </div>
      </div>
    );
  }

  // Standard metric cards (Mid Price, Spread)
  const isMid = type === 'mid-price';
  const displayColor = isMid ? valColor : 'var(--text-primary)';
  const cardClass = isMid ? 'mid' : 'spread';
  return (
    <div className={`glass-panel metric-card ${cardClass}`}>
      <span className="metric-label">{title}</span>
      <div className="metric-value-container">
        <span className="metric-value" style={{ color: displayColor, transition: 'color 0.2s' }}>
          {formatVal(value)}
        </span>
        {subText && <span className="metric-sub">{subText}</span>}
      </div>
      <div className="metric-visual-bar">
        <div 
          className="metric-visual-fill" 
          style={{ 
            width: isMid ? '75%' : '40%', 
            backgroundColor: isMid ? 'var(--color-cyan)' : 'var(--color-spread)'
          }} 
        />
      </div>
    </div>
  );
}
