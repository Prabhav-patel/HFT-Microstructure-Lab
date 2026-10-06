import { useState, useEffect, useRef } from 'react';
import MetricCard from './components/MetricCard';
import OrderBook from './components/OrderBook';
import FeatureGrid from './components/FeatureGrid';
import LiveChart from './components/LiveChart';
import UserManual from './components/UserManual';
import PaperTrading from './components/PaperTrading';
import Simulation from './components/Simulation';

export default function App() {
  const [activeTab, setActiveTab] = useState('terminal'); // 'terminal', 'orderbook', 'features', 'manual', 'papertrade', 'simulation'
  const [isConnected, setIsConnected] = useState(false);
  const [isEngineRunning, setIsEngineRunning] = useState(false);
  const [marketData, setMarketData] = useState(null);
  const [paperState, setPaperState] = useState(null);
  const [loggerStatus, setLoggerStatus] = useState(null);
  const [logs, setLogs] = useState([
    { type: 'system', text: 'Dashboard initialized. Select tabs above to view HFT components.' }
  ]);

  const socketRef = useRef(null);
  const logsContainerRef = useRef(null);

  // Auto-scroll logs terminal to bottom without scrolling the outer browser page viewport
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Connect to backend WebSocket server
  useEffect(() => {
    let reconnectTimer;

    function connect() {
      const wsHost = window.location.hostname || 'localhost';
      const isDev = window.location.port === '5173';
      const wsPort = isDev ? ':3001' : (window.location.port ? `:${window.location.port}` : '');
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

      addLog(`Connecting to backend server on ${wsProtocol}//${wsHost}${wsPort}...`, 'system');

      const socket = new WebSocket(`${wsProtocol}//${wsHost}${wsPort}`);
      socketRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        addLog('Connected to HFT Stream Server.', 'system');
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'status') {
            setIsEngineRunning(data.running);
            addLog(`HFT Engine process status updated: ${data.running ? 'RUNNING' : 'STOPPED'}`, 'system');
          } else if (data.type === 'data') {
            setMarketData(data.payload);
            if (data.payload.paper_trading) setPaperState(data.payload.paper_trading);
            if (data.payload.logger_status) setLoggerStatus(data.payload.logger_status);
          } else if (data.type === 'log') {
            const isError = data.payload.includes('[ERROR]') || data.payload.includes('error');
            addLog(data.payload, isError ? 'error' : 'normal');
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        setIsEngineRunning(false);
        addLog('Lost connection to Stream Server. Retrying in 3 seconds...', 'error');

        reconnectTimer = setTimeout(() => {
          connect();
        }, 3000);
      };

      socket.onerror = (err) => {
        console.error('WebSocket connection error:', err);
      };
    }

    connect();

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
      clearTimeout(reconnectTimer);
    };
  }, []);

  // Log append helper
  const addLog = (text, type = 'normal') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => {
      const updated = [...prev, { timestamp, text, type }];
      if (updated.length > 100) {
        updated.shift();
      }
      return updated;
    });
  };

  const [isWarningActive, setIsWarningActive] = useState(false);
  const prevHealthRef = useRef({ crossed_fixes: 0, resync_count: 0 });
  const warningTimerRef = useRef(null);

  useEffect(() => {
    if (marketData) {
      const currentCrossed = marketData.crossed_fixes || 0;
      const currentResync = marketData.resync_count || 0;
      const prev = prevHealthRef.current;

      if (currentResync > prev.resync_count || (currentCrossed - prev.crossed_fixes) > 2) {
        setIsWarningActive(true);
        if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
        warningTimerRef.current = setTimeout(() => {
          setIsWarningActive(false);
        }, 5000);
      }
      prevHealthRef.current = { crossed_fixes: currentCrossed, resync_count: currentResync };
    }
  }, [marketData]);

  // Toggle C++ subprocess execution
  const toggleEngine = () => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      addLog('Cannot toggle engine: Not connected to backend server.', 'error');
      return;
    }

    if (isEngineRunning) {
      addLog('Requesting C++ engine stop...', 'system');
      socketRef.current.send(JSON.stringify({ type: 'STOP_ENGINE' }));
    } else {
      addLog('Requesting C++ engine start...', 'system');
      socketRef.current.send(JSON.stringify({ type: 'START_ENGINE' }));
    }
  };

  // Build backend API base URL (handles dev vs production port differences)
  const getApiBase = () => {
    const host = window.location.hostname || 'localhost';
    const port = window.location.port === '5173' ? '3001' : (window.location.port || '3001');
    return `http://${host}:${port}`;
  };

  const handleResetPaperTrader = async () => {
    try {
      await fetch(`${getApiBase()}/api/paper/reset`, { method: 'POST' });
      addLog('Paper trader session reset.', 'system');
    } catch {
      addLog('Failed to reset paper trader.', 'error');
    }
  };

  const handleReactivateKillSwitch = async () => {
    try {
      await fetch(`${getApiBase()}/api/paper/reactivate`, { method: 'POST' });
      addLog('Paper trader kill-switch reset. Trading re-enabled.', 'system');
    } catch {
      addLog('Failed to reactivate kill-switch.', 'error');
    }
  };

  // Switch the fee the paper trader charges. Zero isolates signal quality from
  // cost drag; the session restarts so statistics never mix two cost regimes.
  const handleSetFee = async (feeRate) => {
    try {
      const res = await fetch(`${getApiBase()}/api/paper/fee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeRate }),
      });
      const data = await res.json();
      addLog(
        data.ok ? data.message : `Fee change rejected: ${data.message}`,
        data.ok ? 'system' : 'error',
      );
    } catch {
      addLog('Failed to change fee.', 'error');
    }
  };

  // Restrict to top 5 levels for compact visual terminal dashboards
  const compactBids = marketData?.bids ? marketData.bids.slice(0, 5) : [];
  const compactAsks = marketData?.asks ? marketData.asks.slice(0, 5) : [];

  const handleMouseMove = (e) => {
    const panels = document.querySelectorAll('.glass-panel');
    panels.forEach((panel) => {
      const rect = panel.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      panel.style.setProperty('--mouse-x', `${x}px`);
      panel.style.setProperty('--mouse-y', `${y}px`);
    });
  };

  return (
    <div className="dashboard-container" onMouseMove={handleMouseMove}>
      {/* HEADER SECTION WITH NAVIGATION TABS */}
      <header className="glass-panel header">
        <div className="title-section">
          <h1>HFT MARKET TERMINAL</h1>
          <p>BTCUSDT Order Book & Microstructure Research</p>
        </div>

        {/* Tab Selector Links */}
        <div className="nav-tabs">
          <button
            className={`nav-tab ${activeTab === 'terminal' ? 'active' : ''}`}
            onClick={() => setActiveTab('terminal')}
          >
            LIVE TERMINAL
          </button>
          <button
            className={`nav-tab ${activeTab === 'orderbook' ? 'active' : ''}`}
            onClick={() => setActiveTab('orderbook')}
          >
            ORDER BOOK
          </button>
          <button
            className={`nav-tab ${activeTab === 'features' ? 'active' : ''}`}
            onClick={() => setActiveTab('features')}
          >
            FEATURES
          </button>
          <button
            className={`nav-tab ${activeTab === 'papertrade' ? 'active' : ''}`}
            onClick={() => setActiveTab('papertrade')}
          >
            PAPER TRADE
          </button>
          <button
            className={`nav-tab ${activeTab === 'simulation' ? 'active' : ''}`}
            onClick={() => setActiveTab('simulation')}
          >
            SIMULATION
          </button>
          <button
            className={`nav-tab ${activeTab === 'manual' ? 'active' : ''}`}
            onClick={() => setActiveTab('manual')}
          >
            USER MANUAL
          </button>
        </div>

        <div className="controls-section">
          <div className="status-badge">
            Server:
            <span className={`status-pulse ${isConnected ? 'active' : 'inactive'}`} />
            <span style={{ color: isConnected ? 'var(--color-bid)' : 'var(--color-ask)' }}>
              {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
            </span>
          </div>

          <div className="status-badge">
            Engine:
            <span className={`status-pulse ${isEngineRunning ? 'active' : 'inactive'}`} />
            <span style={{ color: isEngineRunning ? 'var(--color-bid)' : 'var(--color-ask)' }}>
              {isEngineRunning ? 'RUNNING' : 'OFFLINE'}
            </span>
          </div>

          <button
            onClick={toggleEngine}
            className={`btn ${isEngineRunning ? 'btn-stop' : 'btn-start'}`}
            disabled={!isConnected}
          >
            {isEngineRunning ? 'STOP ENGINE' : 'START ENGINE'}
          </button>
        </div>
      </header>

      {/* TOP SUMMARY BAR (Shown on all data tabs) */}
      {activeTab !== 'manual' && activeTab !== 'papertrade' && activeTab !== 'simulation' && (
        <div className="top-metrics-grid">
          <MetricCard
            title="MID PRICE (USD)"
            type="mid-price"
            value={marketData?.mid_price}
            subText={marketData?.time ? `Last Tick: ${marketData.time}` : ''}
            rawData={marketData}
          />

          <MetricCard
            title="SPREAD"
            type="spread"
            value={marketData?.spread}
            subText="Bid-Ask Spread"
            rawData={marketData}
          />

          <MetricCard
            title="BEST BID / ASK"
            type="bid-ask"
            rawData={marketData}
          />

          <MetricCard
            title="ORDER BOOK IMBALANCE"
            type="imbalance"
            rawData={marketData}
          />
        </div>
      )}

      {/* TAB SUB-ROUTER RENDERING */}

      {/* 1. Live Terminal View */}
      {activeTab === 'terminal' && (
        <div className="main-content-grid">
          {/* Charts & Logs */}
          <div className="left-column">
            <LiveChart rawData={marketData} />

            {/* System Health Panel */}
            <div className={`glass-panel system-health-panel ${isWarningActive ? 'warning-active' : ''}`} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="panel-title" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '6px', marginBottom: '4px' }}>
                <span>SYSTEM DATA INTEGRITY HEALTH</span>
                <span className="panel-subtitle" style={{ color: isWarningActive ? 'var(--color-ask)' : 'var(--color-bid)', transition: 'color 0.3s' }}>
                  {isWarningActive ? 'WARNING: ANOMALIES DETECTED' : 'SYSTEM HEALTHY'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', textAlign: 'center' }}>
                <div style={{ background: 'rgba(0,0,0,0.15)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>RESYNC COUNT</span>
                  <span style={{ fontSize: '1.25rem', fontFamily: 'var(--font-display)', color: (marketData?.resync_count || 0) > 0 ? 'var(--color-ask)' : 'var(--color-bid)', fontWeight: 'bold' }}>
                    {marketData?.resync_count || 0}
                  </span>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Gap Re-bootstraps</span>
                </div>
                <div style={{ background: 'rgba(0,0,0,0.15)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>CROSSED FIXES</span>
                  <span style={{ fontSize: '1.25rem', fontFamily: 'var(--font-display)', color: (marketData?.crossed_fixes || 0) > 0 ? 'var(--color-spread)' : 'var(--color-bid)', fontWeight: 'bold' }}>
                    {marketData?.crossed_fixes || 0}
                  </span>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Overlaps Cleaned</span>
                </div>
                <div style={{ background: 'rgba(0,0,0,0.15)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>INVALID UPDATES</span>
                  <span style={{ fontSize: '1.25rem', fontFamily: 'var(--font-display)', color: (marketData?.invalid_updates || 0) > 0 ? 'var(--color-spread)' : 'var(--color-bid)', fontWeight: 'bold' }}>
                    {marketData?.invalid_updates || 0}
                  </span>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Filtered Ticks</span>
                </div>
              </div>
            </div>

            {/* Logs console */}
            <div className="glass-panel logs-panel">
              <div className="panel-title">
                <span>SYSTEM LOGS & PROCESS STDOUT</span>
                <span className="panel-subtitle">Logs console</span>
              </div>
              <div className="logs-content" ref={logsContainerRef}>
                {logs.map((log, index) => (
                  <div key={index} className={`log-entry ${log.type}`}>
                    {log.timestamp && <span style={{ color: 'var(--text-muted)', marginRight: '6px' }}>[{log.timestamp}]</span>}
                    <span>{log.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Compact LOB and Features grid */}
          <div className="right-column">
            <OrderBook
              bids={compactBids}
              asks={compactAsks}
              midPrice={marketData?.mid_price}
              spread={marketData?.spread}
            />

            <FeatureGrid features={marketData?.features} isExpandedTab={false} />
          </div>
        </div>
      )}

      {/* 2. Dedicated Order Book Tab View */}
      {activeTab === 'orderbook' && (
        <div className="expanded-orderbook-grid">
          <OrderBook
            bids={marketData?.bids || []}
            asks={marketData?.asks || []}
            midPrice={marketData?.mid_price}
            spread={marketData?.spread}
          />

          <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="panel-title">LOB MECHANICS & ANALYSIS</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5' }}>
              The <strong>Limit Order Book (LOB)</strong> represents passive buyers (Bids, green) and sellers (Asks, red) lined up at different price levels.
              The bars behind the prices represent the proportional size (depth) at each level relative to the largest size inside the book.
            </p>
            <div className="manual-callout" style={{ margin: '0' }}>
              <h4 style={{ color: 'var(--color-spread)' }}>Spread & Midpoint Analysis</h4>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                When the C++ engine processes trade updates, it checks for Crossed Books (bid &gt;= ask).
                If crossed levels are detected due to network latency, the engine corrects them and records a crossed_fixes statistic
                to ensure feature calculation safety.
              </p>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '20px' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>TOTAL STORED DEPTH</span>
              <span style={{ fontSize: '2rem', fontFamily: 'var(--font-display)', color: 'var(--color-cyan)', fontWeight: 'bold', margin: '10px 0' }}>
                {marketData ? (marketData.bids_depth + marketData.asks_depth) : '0'} Levels
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Bids: {marketData?.bids_depth || 0} | Asks: {marketData?.asks_depth || 0}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 3. Dedicated Features Grid Tab View */}
      {activeTab === 'features' && (
        <div className="expanded-features-grid-layout">
          <FeatureGrid features={marketData?.features || {}} isExpandedTab={true} />
        </div>
      )}

      {/* 4. Paper Trading Tab View */}
      {activeTab === 'papertrade' && (
        <PaperTrading
          paperState={paperState}
          marketData={marketData}
          onReset={handleResetPaperTrader}
          onToggleKillSwitch={handleReactivateKillSwitch}
          onSetFee={handleSetFee}
        />
      )}

      {/* 5. Simulation & Backtest Tab View */}
      {activeTab === 'simulation' && (
        <Simulation
          loggerStatus={loggerStatus}
          marketData={marketData}
        />
      )}

      {/* 6. Layman User Manual Tab View */}
      {activeTab === 'manual' && (
        <UserManual />
      )}
    </div>
  );
}
