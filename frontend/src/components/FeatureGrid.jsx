import { useEffect, useState, useRef } from 'react';

// Layman's guide definitions for each feature
const tooltipGlossary = {
  spr: {
    title: "Bid-Ask Spread",
    desc: "The cost of trading immediately. A <strong>tighter spread</strong> (closer to $0.01) means high liquidity and lower entry/exit costs."
  },
  mp: {
    title: "Mid-Price",
    desc: "The mathematical center of the market. It is the average of the highest bid and lowest ask."
  },
  mcp: {
    title: "Micro-Price",
    desc: "An average price weighted by bid/ask quantities. If buyers want more than sellers offer, micro-price shifts up, signaling a <strong>potential price rise</strong>."
  },
  obi: {
    title: "Order Book Imbalance",
    desc: "Compares buyer size vs seller size at the top level. Ranges from <strong>-1.0 (sell pressure)</strong> to <strong>+1.0 (buy pressure)</strong>."
  },
  ofi: {
    title: "Order Flow Imbalance",
    desc: "Measures the flow rate of new orders. Positive means buy orders are <strong>accumulating faster</strong> than sell orders."
  },
  ti: {
    title: "Trade Imbalance (1s)",
    desc: "Measures aggressive market order volumes over a 1s window. Positive means **aggressive buyers are dominating**."
  },
  tr: {
    title: "Trade Rate",
    desc: "Trades executed per second. High trade rates indicate **volatile market activity** and excitement."
  },
  vwap_d: {
    title: "VWAP Deviation",
    desc: "Distance from volume-weighted trade price. Positive means the mid-price is **trading above the actual average traded price**."
  },
  b_sw: {
    title: "Bid Skewness (Top 10)",
    desc: "Shape of buy liquidity. Negative value means buy sizes are **packed close to the top**, representing immediate support."
  },
  a_sw: {
    title: "Ask Skewness (Top 10)",
    desc: "Shape of sell liquidity. Negative value means sell sizes are **packed close to the top**, representing immediate resistance."
  }
};

function getSignalClass(signal = '') {
  const s = signal.toLowerCase();
  if (s.includes('up') || s.includes('buy') || s.includes('bid pressure') || s.includes('wider') || s.includes('more active')) {
    return 'green';
  }
  if (s.includes('down') || s.includes('sell') || s.includes('ask pressure') || s.includes('tighter') || s.includes('less active')) {
    return 'red';
  }
  return 'neutral';
}

function FeatureCard({ name, data }) {
  const [flashClass, setFlashClass] = useState('');
  const prevValRef = useRef(data?.value);
  const canvasRef = useRef(null);
  const historyRef = useRef([]);

  // Trigger border flashing on update
  useEffect(() => {
    if (data?.value !== undefined) {
      if (prevValRef.current !== undefined && data.value > prevValRef.current) {
        setFlashClass('flash-up');
        const timer = setTimeout(() => setFlashClass(''), 600);
        prevValRef.current = data.value;
        return () => clearTimeout(timer);
      } else if (prevValRef.current !== undefined && data.value < prevValRef.current) {
        setFlashClass('flash-down');
        const timer = setTimeout(() => setFlashClass(''), 600);
        prevValRef.current = data.value;
        return () => clearTimeout(timer);
      }
      prevValRef.current = data.value;
    }
  }, [data?.value]);

  // Update and draw mini-sparkline on canvas
  useEffect(() => {
    if (data?.value === undefined) return;
    
    const history = historyRef.current;
    history.push(data.value);
    
    if (history.length > 40) {
      history.shift();
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);
    if (history.length < 2) return;

    const min = Math.min(...history);
    const max = Math.max(...history);
    const range = max - min > 0 ? max - min : 1.0;

    const stepX = w / (40 - 1);
    const startX = w - (history.length - 1) * stepX;

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.7)';
    ctx.lineWidth = 1.5;
    
    history.forEach((val, idx) => {
      const x = startX + idx * stepX;
      // Scale Y value inside canvas box height
      const y = h - ((val - min) / range) * (h - 4) - 2;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

  }, [data?.value]);

  const valueDisplay = data?.formatted_value || (data?.value !== undefined ? data.value.toFixed(4) : '-');
  const signal = data?.signal || 'Stable';
  const glossaryItem = tooltipGlossary[name] || { title: name, desc: data?.description || '' };

  return (
    <div className={`feature-card ${flashClass}`}>
      <div className="feature-top">
        <span className="feature-name">{name.toUpperCase()}</span>
        <span className={`feature-pill ${getSignalClass(signal)}`}>
          {signal}
        </span>
      </div>
      <div className="feature-val">{valueDisplay}</div>
      <div className="feature-desc">{glossaryItem.title}</div>
      
      {/* Sparkline Visual */}
      <div className="feature-sparkline-container">
        <canvas ref={canvasRef} className="feature-sparkline-canvas" />
      </div>

      {/* Hover Tooltip Box */}
      <div className="tooltip-box">
        <div className="tooltip-header">{glossaryItem.title} ({name})</div>
        <div 
          className="tooltip-body" 
          dangerouslySetInnerHTML={{ __html: glossaryItem.desc }}
        />
      </div>
    </div>
  );
}

export default function FeatureGrid({ features = {}, isExpandedTab = false }) {
  const featureNames = Object.keys(features).sort();

  return (
    <div className="glass-panel features-panel">
      <div className="panel-title">
        <span>MICROSTRUCTURE FEATURES ANALYTICS</span>
        <span className="panel-subtitle">Hover cards for layman guide | Canvas sparklines represent live history</span>
      </div>
      
      <div className={`features-grid ${isExpandedTab ? 'expanded-features-tab-grid' : ''}`}>
        {featureNames.map((name) => (
          <FeatureCard 
            key={name} 
            name={name} 
            data={features[name]} 
          />
        ))}
        {featureNames.length === 0 && (
          <div style={{ color: 'var(--text-muted)', gridColumn: '1 / -1', textAlign: 'center', padding: '40px', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
            Waiting for C++ engine feature stream...
          </div>
        )}
      </div>
    </div>
  );
}
