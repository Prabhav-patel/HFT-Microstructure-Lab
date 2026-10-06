import { useEffect, useRef } from 'react';

export default function LiveChart({ rawData }) {
  const canvasRef = useRef(null);
  
  // Keep history queues in refs to avoid React re-render overhead
  const historyRef = useRef([]);
  const maxHistoryPoints = 150;

  useEffect(() => {
    if (!rawData || !rawData.mid_price) return;

    const mid = rawData.mid_price;
    const mcp = rawData.features?.mcp?.value || mid;
    const obi = rawData.features?.obi?.value || 0;
    const time = rawData.time || '';

    // Append to history
    const history = historyRef.current;
    history.push({ mid, mcp, obi, time });

    // Enforce max length
    if (history.length > maxHistoryPoints) {
      history.shift();
    }

    // Trigger canvas draw
    drawChart();
  }, [rawData]);

  // Handle window resizing
  useEffect(() => {
    const handleResize = () => {
      drawChart();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const drawChart = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const history = historyRef.current;
    if (history.length < 2) return;

    // Get exact visual size and account for Retina displays (High DPI)
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Clear Canvas
    ctx.fillStyle = '#07090e';
    ctx.fillRect(0, 0, width, height);

    // Render Grid Lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    const gridCols = 8;
    const gridRows = 6;
    
    // Draw columns
    for (let i = 1; i < gridCols; i++) {
      const x = (width / gridCols) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    
    // Draw rows
    for (let i = 1; i < gridRows; i++) {
      const y = (height / gridRows) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Split Height: Upper 70% for Prices, Lower 30% for Imbalance
    const priceHeight = height * 0.68;
    const obiHeight = height * 0.26;
    const obiStartY = height * 0.72;

    // Min/Max for Prices in history
    const prices = history.flatMap(h => [h.mid, h.mcp]);
    let minPrice = Math.min(...prices);
    let maxPrice = Math.max(...prices);
    
    // Add small buffer to price window
    const priceDiff = maxPrice - minPrice;
    const buffer = priceDiff > 0 ? priceDiff * 0.08 : 1.0;
    minPrice -= buffer;
    maxPrice += buffer;

    // Calculate step width for history points
    const stepX = width / (maxHistoryPoints - 1);
    const startIndex = maxHistoryPoints - history.length;

    // --- DRAW PRICES (MID & MICRO) ---
    const getPriceY = (val) => {
      return priceHeight - ((val - minPrice) / (maxPrice - minPrice)) * (priceHeight - 20);
    };

    // 1. Draw Micro Price Line (Purple/Magenta)
    ctx.beginPath();
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 1.5;
    history.forEach((pt, idx) => {
      const x = (startIndex + idx) * stepX;
      const y = getPriceY(pt.mcp);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 2. Draw Mid Price Line (Neon Cyan)
    ctx.beginPath();
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2.0;
    // Glowing shadow for mid-price
    ctx.shadowColor = 'rgba(0, 229, 255, 0.4)';
    ctx.shadowBlur = 6;
    history.forEach((pt, idx) => {
      const x = (startIndex + idx) * stepX;
      const y = getPriceY(pt.mid);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    
    // Reset shadow
    ctx.shadowBlur = 0;

    // --- DRAW IMBALANCE (OBI) ---
    // OBI centers at obiStartY + obiHeight/2
    const obiCenterY = obiStartY + obiHeight / 2;
    
    // Draw OBI Zero Line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.moveTo(0, obiCenterY);
    ctx.lineTo(width, obiCenterY);
    ctx.stroke();

    const getObiY = (val) => {
      // val ranges from -1 to 1
      return obiCenterY - (val * (obiHeight / 2));
    };

    // Draw OBI Area Graph
    ctx.lineWidth = 1;
    history.forEach((pt, idx) => {
      const x = (startIndex + idx) * stepX;
      const y = getObiY(pt.obi);
      
      ctx.beginPath();
      ctx.moveTo(x, obiCenterY);
      ctx.lineTo(x, y);
      
      // Color based on positive or negative imbalance
      ctx.strokeStyle = pt.obi >= 0 ? 'rgba(0, 230, 118, 0.5)' : 'rgba(255, 23, 68, 0.5)';
      ctx.stroke();
    });

    // Draw Price Labels (Y-Axis ticks)
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Fira Code';
    ctx.textAlign = 'right';
    ctx.fillText(maxPrice.toFixed(2), width - 8, 15);
    ctx.fillText(((maxPrice + minPrice) / 2).toFixed(2), width - 8, priceHeight / 2);
    ctx.fillText(minPrice.toFixed(2), width - 8, priceHeight - 5);

    // Draw OBI Labels
    ctx.fillText('+1.0 OBI', width - 8, obiStartY + 10);
    ctx.fillText('0.0', width - 8, obiCenterY - 2);
    ctx.fillText('-1.0 OBI', width - 8, obiStartY + obiHeight - 2);

    // Time stamp label for last point
    const lastPt = history[history.length - 1];
    ctx.textAlign = 'left';
    ctx.fillText(`Time: ${lastPt.time}`, 10, height - 10);
    
    // Draw Legend
    ctx.fillStyle = 'rgba(12, 16, 26, 0.8)';
    ctx.fillRect(10, 10, 310, 26);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.strokeRect(10, 10, 310, 26);
    
    ctx.font = '10px Inter';
    
    // Mid Price Legend
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(18, 20, 8, 8);
    ctx.fillStyle = '#f1f5f9';
    ctx.fillText(`Mid: ${lastPt.mid.toFixed(2)}`, 32, 27);

    // Micro Price Legend
    ctx.fillStyle = '#a855f7';
    ctx.fillRect(122, 20, 8, 8);
    ctx.fillStyle = '#f1f5f9';
    ctx.fillText(`Micro: ${lastPt.mcp.toFixed(2)}`, 136, 27);

    // OBI Legend
    ctx.fillStyle = lastPt.obi >= 0 ? '#00e676' : '#ff1744';
    ctx.fillRect(226, 20, 8, 8);
    ctx.fillStyle = '#f1f5f9';
    ctx.fillText(`Imbalance: ${lastPt.obi.toFixed(3)}`, 240, 27);
  };

  return (
    <div className="glass-panel chart-panel">
      <div className="panel-title">
        <span>REAL-TIME ANALYSIS PLOT</span>
        <span className="panel-subtitle">Prices (LHS) & Order Book Imbalance (RHS)</span>
      </div>
      <div className="chart-wrapper">
        <canvas ref={canvasRef} className="chart-canvas" />
      </div>
    </div>
  );
}
