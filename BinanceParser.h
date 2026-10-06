#pragma once
#include <string>
#include <iostream>
#include "json.hpp"
#include "MarketHandler.h"

using json = nlohmann::json;

class BinanceParser {
private:
    IEventHandler* handler;

public:
    explicit BinanceParser(IEventHandler* handler_ptr) : handler(handler_ptr) {}

    bool needs_rebootstrap() {
        return handler ? handler->needs_rebootstrap() : false;
    }

    void reset_sync() {
        if (handler) handler->reset_sync();
    }

    void parseMessage(const std::string& message) {
        try {
            auto data = json::parse(message);
            
            if (!data.contains("stream") || !data.contains("data")) return;
            
            std::string stream = data["stream"];
            auto payload = data["data"];

            if (stream == "btcusdt@trade") {
                TradeEvent trade;
                trade.p = std::stod(payload["p"].get<std::string>());
                trade.q = std::stod(payload["q"].get<std::string>());
                trade.ts = payload["T"].get<int64_t>();
                trade.is_buy = payload.contains("m") ? !payload["m"].get<bool>() : false;

                if (handler) {
                    handler->on_trd(trade);
                }
            } 
            else if (stream == "btcusdt@snapshot") {
                DepthEvent snap;
                snap.is_snapshot = true;
                
                if (payload.contains("lastUpdateId")) {
                    snap.uid = payload["lastUpdateId"].get<int64_t>();
                } else {
                    snap.uid = 0;
                }

                if (payload.contains("bids")) {
                    for (const auto& b : payload["bids"]) {
                        snap.b.push_back({
                            std::stod(b[0].get<std::string>()), 
                            std::stod(b[1].get<std::string>())
                        });
                    }
                }

                if (payload.contains("asks")) {
                    for (const auto& a : payload["asks"]) {
                        snap.a.push_back({
                            std::stod(a[0].get<std::string>()), 
                            std::stod(a[1].get<std::string>())
                        });
                    }
                }

                if (handler) {
                    handler->on_dpth(snap);
                }
            }
            else if (stream == "btcusdt@depth") {
                DepthEvent depth;
                depth.is_snapshot = false;
                
                if (payload.contains("U")) {
                    depth.first_update_id = payload["U"].get<int64_t>();
                } else {
                    depth.first_update_id = 0;
                }

                if (payload.contains("u")) {
                    depth.uid = payload["u"].get<int64_t>();
                } else {
                    depth.uid = 0;
                }

                if (payload.contains("b")) {
                    for (const auto& b : payload["b"]) {
                        depth.b.push_back({
                            std::stod(b[0].get<std::string>()), 
                            std::stod(b[1].get<std::string>())
                        });
                    }
                }

                if (payload.contains("a")) {
                    for (const auto& a : payload["a"]) {
                        depth.a.push_back({
                            std::stod(a[0].get<std::string>()), 
                            std::stod(a[1].get<std::string>())
                        });
                    }
                }

                if (handler) {
                    handler->on_dpth(depth);
                }
            }
        }
        catch (const std::exception& e) {
            std::cerr << "Parse error ignored: " << e.what() << "\n";
        }
    }
};
