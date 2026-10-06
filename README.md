# Market microstructure research system

This is an educational, **paper-trading** system for studying BTC/USDT order-book events. The original project was developed separately and is being published here as a curated source copy. It is not a production HFT system, does not route live orders, and has no verified trading edge or end-to-end latency benchmark.

## What is implemented

`trade_stream.py` subscribes to Binance trade/depth messages and obtains an order-book snapshot. The C++ engine (`main.cpp`, `LimitOrderBookEngine.h`, `BinanceParser.h`) applies depth events with sequence-gap detection and re-bootstrap logic. `FeatureEngineering.h` computes 13 exploratory microstructure features. A local Node backend records ticks, runs a fee-aware paper-trading simulation and replays saved ticks; a React frontend displays the book, features and simulated position. The system design and feature weights are hypotheses, not measured alpha.

The order-book tests cover snapshot ordering, deletion of zero-quantity levels, crossed-book handling, and sequence-gap detection. They do **not** establish market-data correctness in all live conditions or profitable execution.

## Run locally

1. Use a modern C++17 compiler (GCC 7+ or current Clang/MSVC). Compile `main.cpp` as `engine.exe` on Windows, or adapt the backend spawn path for your platform. The vendored `json.hpp` is nlohmann/json 3.12.0 (MIT license noted in that file).
2. Install Python `websocket-client`, then in `backend/` run `npm ci` and `npm start`.
3. In `frontend/`, run `npm ci` and `npm run dev`. Open the local URL printed by Vite.
4. For the isolated book tests, compile `test_lob.cpp` with `-std=c++17` and run it. No exchange connection or credentials are needed for those tests.

The backend expects the engine executable in the project root and a working Python interpreter; `HFT_PYTHON_EXECUTABLE` can select one. Network access is needed only for live public market data. No brokerage account or API keys are required. Local tick logs are excluded from Git; **do not commit secrets or private trading data**.

## Evidence and limitations

- Verified here: the four order-book unit tests passed with the locally available GCC 6.3. That compiler is too old to build the full engine because the JSON header requires C++17 `<optional>`; the full-stack build remains **unverified** in this environment.
- The paper trader includes a simple spread/fee model, but recorded ticks cannot reproduce real queue position, market impact or exchange latency.
- Published source excludes captured tick files, executables, dependency folders, and internal execution notes. No measured Sharpe, hit rate, or sub-millisecond claim is made here.

Research/education only; not investment advice.
