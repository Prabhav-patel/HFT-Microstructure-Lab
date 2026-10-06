#include "LimitOrderBookEngine.h"
#include "MarketHandler.h"
#include "BinanceParser.h" 
#include "ProcessDataFeed.h"
#include <cstdlib>
#include <fstream>
#include <string>

int main(int argc, char* argv[]) {
    bool json_mode = false;
    bool simulate_gap = false;
    for (int i = 1; i < argc; ++i) {
        if (std::string(argv[i]) == "--json") {
            json_mode = true;
        }
        if (std::string(argv[i]) == "--simulate-gap") {
            simulate_gap = true;
        }
    }

    LimitOrderBook lob;
    if (simulate_gap) {
        lob.set_simulate_gap(true);
    }
    FeatureEngine fe(&lob);
    MarketHandler hndlr(&lob, &fe, json_mode);
    
    BinanceParser parser(&hndlr);
    // Prefer an explicitly configured interpreter, then the project-local
    // virtual environment. Fall back to the Python launcher for older setups.
    std::string python_executable = "py";
    if (const char* configured_python = std::getenv("HFT_PYTHON_EXECUTABLE")) {
        if (*configured_python != '\0') {
            python_executable = configured_python;
        }
    } else if (std::ifstream(".venv\\Scripts\\python.exe").good()) {
        python_executable = ".venv\\Scripts\\python.exe";
    }

    ProcessDataFeed feed("\"" + python_executable + "\" trade_stream.py", parser, json_mode);
    
    feed.start();

    return 0;
}
