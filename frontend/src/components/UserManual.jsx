
export default function UserManual() {
  return (
    <div className="manual-container">
      <div className="manual-hero">
        <h2>HFT LOB & Feature Engineering Manual</h2>
        <p>A layman's guide to understanding the mechanics behind the live trading terminal.</p>
      </div>

      <div className="manual-section">
        <h3>1. What is a Limit Order Book (LOB)?</h3>
        <p>
          Unlike retail stores with fixed price tags, financial markets like Bitcoin trade via a double-auction system. 
          The **Limit Order Book** is a real-time list of all pending orders submitted by traders:
        </p>
        <ul>
          <li><strong>Bids (Buy Orders)</strong>: Represent traders who want to buy Bitcoin. They specify the maximum price they are willing to pay and the amount. Bids are sorted from highest price to lowest price.</li>
          <li><strong>Asks (Sell Orders)</strong>: Represent traders who want to sell Bitcoin. They specify the minimum price they are willing to accept and the amount. Asks are sorted from lowest price to highest price.</li>
          <li><strong>Bid-Ask Spread</strong>: The gap between the highest bid price and the lowest ask price. In highly liquid markets like BTCUSDT, this spread is often just <strong>$0.01</strong>.</li>
        </ul>
        <div className="manual-callout">
          <h4>💡 Layman Analogy</h4>
          <p>
            Imagine a housing market: Buyers are calling out bid offers ("I will pay $500k", "I will pay $498k"). 
            Sellers are calling out asking prices ("I want $505k", "I want $510k"). 
            The **Spread** is the gap between $500k and $505k. 
            No transaction occurs until a buyer agrees to pay a seller's ask, or a seller agrees to accept a buyer's bid.
          </p>
        </div>
      </div>

      <div className="manual-section">
        <h3>2. What is High-Frequency Trading (HFT)?</h3>
        <p>
          HFT refers to computer algorithms executing thousands of orders per second. Because machines operate at microsecond speeds, 
          they look at tiny, short-lived imbalances in the order book to predict where the price will move in the next few seconds or milliseconds. 
          To do this, they compute **Microstructure Features**—mathematical signals representing supply and demand dynamics.
        </p>
      </div>

      <div className="manual-section">
        <h3>3. Microstructure Features Glossary</h3>
        <p>
          Our C++ engine computes ten distinct features from the live data feed. Hovering over cards on the **Features** tab also displays these definitions:
        </p>

        <div className="manual-features-glossary">
          <div className="glossary-card">
            <div className="glossary-card-header">
              <span className="glossary-term">spr — Bid-Ask Spread</span>
              <span className="glossary-desc">Formula: ask - bid</span>
            </div>
            <div className="glossary-body">
              Measures the immediate cost of trading. A **wider spread** indicates lower liquidity or higher volatility, meaning you pay more to buy immediately. A **tighter spread** (near $0.01) means high liquidity and low transaction friction.
            </div>
          </div>

          <div className="glossary-card">
            <div className="glossary-card-header">
              <span className="glossary-term">mp — Mid-Price</span>
              <span className="glossary-desc">Formula: (bid + ask) / 2</span>
            </div>
            <div className="glossary-body">
              The mathematical center of the market. It is the standard reference price. However, it can be misleading because it ignores *how many* orders exist at the top levels.
            </div>
          </div>

          <div className="glossary-card">
            <div className="glossary-card-header">
              <span className="glossary-term">mcp — Micro-Price</span>
              <span className="glossary-desc">Formula: Size-weighted average price</span>
            </div>
            <div className="glossary-body">
              An inventory-adjusted price. If there are 10 Bitcoins wanted at the bid, but only 1 Bitcoin offered at the ask, the Micro-price will sit **very close to the ask price**. This indicates that buying pressure is strong and the mid-price is likely to rise to match it.
            </div>
          </div>

          <div className="glossary-card">
            <div className="glossary-card-header">
              <span className="glossary-term">obi — Order Book Imbalance</span>
              <span className="glossary-desc">Formula: (bid_qty - ask_qty) / (bid_qty + ask_qty)</span>
            </div>
            <div className="glossary-body">
              Measures the imbalance of supply and demand at the very best bid and ask levels. It oscillates between **-1.0** (extreme sell pressure, asks dominate) and **+1.0** (extreme buy pressure, bids dominate).
            </div>
          </div>

          <div className="glossary-card">
            <div className="glossary-card-header">
              <span className="glossary-term">ofi — Order Flow Imbalance</span>
              <span className="glossary-desc">Formula: Net flow rate of new orders</span>
            </div>
            <div className="glossary-body">
              Tracks the velocity of order arrivals. Instead of just looking at current book state, it measures **net additions and cancellations**. A positive OFI indicates that buy orders are being stacked or sell orders are being cancelled/filled, signaling upward momentum.
            </div>
          </div>

          <div className="glossary-card">
            <div className="glossary-card-header">
              <span className="glossary-term">ti — Trade Imbalance (1s Window)</span>
              <span className="glossary-desc">Formula: (buy_trades - sell_trades) / total_trades</span>
            </div>
            <div className="glossary-body">
              Measures the aggressiveness of immediate market orders. While OBI tracks traders who are *waiting* in line, Trade Imbalance tracks traders who are *crossing the spread* to buy or sell immediately. A high positive TI shows aggressive buying momentum.
            </div>
          </div>

          <div className="glossary-card">
            <div className="glossary-card-header">
              <span className="glossary-term">tr — Trade Rate</span>
              <span className="glossary-desc">Count of trades per second</span>
            </div>
            <div className="glossary-body">
              Indicates market activity level. A high trade rate shows heavy institutional participation, news-driven trading, or short-term volatility.
            </div>
          </div>

          <div className="glossary-card">
            <div className="glossary-card-header">
              <span className="glossary-term">vwap_d — VWAP Deviation</span>
              <span className="glossary-desc">Formula: mid_price - rolling_vwap</span>
            </div>
            <div className="glossary-body">
              Volume Weighted Average Price (VWAP) represents the average price Bitcoin has traded at over the last window, adjusted for volume. Deviation shows if the current mid-price is **overextended** (above VWAP) or **depressed** (below VWAP) compared to where money actually changed hands.
            </div>
          </div>

          <div className="glossary-card">
            <div className="glossary-card-header">
              <span className="glossary-term">b_sw & a_sw — Bid & Ask Skewness</span>
              <span className="glossary-desc">Shape distribution of top 10 book levels</span>
            </div>
            <div className="glossary-body">
              Measures the "fatness" of the order queues deep in the book (top 10 levels). A negative skewness indicates that liquidity is concentrated near the top of the book, whereas a positive skewness indicates large backup orders are resting deeper down.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
