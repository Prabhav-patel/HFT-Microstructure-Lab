
export default function OrderBook({ bids = [], asks = [], midPrice, spread }) {
  // Find max quantity to scale depth bars
  const maxQty = Math.max(
    ...bids.map(b => b[1] || 0),
    ...asks.map(a => a[1] || 0),
    1.0 // Prevent division by zero
  );

  return (
    <div className="glass-panel orderbook-panel">
      <div className="panel-title">
        <span>LIMIT ORDER BOOK</span>
        <div style={{ display: 'flex', gap: '12px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
          <span>MID: <strong style={{ color: 'var(--color-cyan)' }}>{midPrice ? midPrice.toFixed(2) : '-'}</strong></span>
          <span>SPREAD: <strong style={{ color: 'var(--color-spread)' }}>{spread ? spread.toFixed(2) : '-'}</strong></span>
        </div>
      </div>
      
      <div className="ladder-header">
        <div className="ladder-column-header">
          <span>Bid Price</span>
          <span style={{ textAlign: 'right' }}>Size (BTC)</span>
        </div>
        <div className="ladder-column-header right">
          <span>Ask Price</span>
          <span style={{ textAlign: 'left' }}>Size (BTC)</span>
        </div>
      </div>

      <div className="ladder-rows">
        {/* BIDS SIDE (Left) */}
        <div className="ladder-side">
          {bids.map((bid, i) => {
            const price = bid[0];
            const qty = bid[1];
            const pct = (qty / maxQty) * 100;
            return (
              <div key={`bid-${i}-${price}`} className="depth-row bid">
                <div 
                  className="depth-bar-fill" 
                  style={{ width: `${pct}%` }} 
                />
                <span className="depth-price">{price.toFixed(2)}</span>
                <span className="depth-qty">{qty.toFixed(3)}</span>
              </div>
            );
          })}
          {bids.length === 0 && (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px', fontSize: '0.8rem' }}>
              Waiting for bid data...
            </div>
          )}
        </div>

        {/* ASKS SIDE (Right) */}
        <div className="ladder-side">
          {asks.map((ask, i) => {
            const price = ask[0];
            const qty = ask[1];
            const pct = (qty / maxQty) * 100;
            return (
              <div key={`ask-${i}-${price}`} className="depth-row ask">
                <div 
                  className="depth-bar-fill" 
                  style={{ width: `${pct}%` }} 
                />
                <span className="depth-price">{price.toFixed(2)}</span>
                <span className="depth-qty">{qty.toFixed(3)}</span>
              </div>
            );
          })}
          {asks.length === 0 && (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px', fontSize: '0.8rem' }}>
              Waiting for ask data...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
