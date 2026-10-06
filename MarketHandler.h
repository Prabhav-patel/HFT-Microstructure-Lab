#pragma once
#include <iostream>
#include <iomanip>
#include <sstream>
#include <chrono>
#include <unordered_map>
#include <vector>
#include <string>
#include <ctime>
#include <cmath>
#include "types.h"
#include "LimitOrderBookEngine.h"
#include "FeatureEngineering.h"
#include "json.hpp"

using json = nlohmann::json;

class IEventHandler {
public:
    virtual ~IEventHandler() = default;
    virtual void on_trd(const TradeEvent& e) = 0;
    virtual void on_dpth(const DepthEvent& e) = 0;
    virtual bool needs_rebootstrap() { return false; }
    virtual void reset_sync() {}
};

class MarketHandler : public IEventHandler {
private:
    LimitOrderBook* lob;
    FeatureEngine* fe;
    bool json_mode;

    uint64_t depth_count = 0;
    uint64_t trade_count = 0;
    std::chrono::steady_clock::time_point last_render;
    std::unordered_map<std::string, double> last_features;
    static constexpr double trend_eps = 1e-9;

    std::string pad_right(const std::string& str, size_t width) {
        if (str.length() >= width) return str.substr(0, width);
        return str + std::string(width - str.length(), ' ');
    }

    std::string pad_left(const std::string& str, size_t width) {
        if (str.length() >= width) return str.substr(0, width);
        return std::string(width - str.length(), ' ') + str;
    }

    std::string format_double(double val, int precision) {
        std::stringstream ss;
        ss << std::fixed << std::setprecision(precision) << val;
        return ss.str();
    }

    std::string format_val(const std::string& name, double val) {
        if (name == "mp" || name == "mcp" || name == "spr") {
            return format_double(val, 2);
        } else if (name == "tr") {
            return format_double(val, 0);
        } else if (name == "ofi") {
            return format_double(val, 1);
        }
        return format_double(val, 4);
    }

    std::string interpret_feature(const std::string& key, double val, double prev, bool has_prev) {
        if (key == "obi") {
            if (val > 0.05) return "Bid pressure";
            if (val < -0.05) return "Ask pressure";
            return "Balanced book";
        }
        if (key == "ti") {
            if (val > 0.05) return "Aggressive buys";
            if (val < -0.05) return "Aggressive sells";
            return "Balanced trades";
        }
        if (key == "ofi") {
            if (val > trend_eps) return "Bid flow added";
            if (val < -trend_eps) return "Ask flow added";
            return "Flat flow";
        }
        if (!has_prev || std::fabs(val - prev) <= trend_eps) return "Stable";
        if (key == "mp" || key == "mcp") return val > prev ? "Price up" : "Price down";
        if (key == "spr") return val > prev ? "Spread wider" : "Spread tighter";
        if (key == "vwap_d") return val > prev ? "Mid above VWAP" : "Mid below VWAP";
        if (key == "tr") return val > prev ? "More active" : "Less active";
        return val > prev ? "Rising" : "Falling";
    }

    std::string get_current_time_str() {
        auto now = std::chrono::system_clock::now();
        std::time_t t = std::chrono::system_clock::to_time_t(now);
        char buf[100];
#ifdef _MSC_VER
        struct tm timeinfo;
        localtime_s(&timeinfo, &t);
        std::strftime(buf, sizeof(buf), "%H:%M:%S", &timeinfo);
#else
        std::strftime(buf, sizeof(buf), "%H:%M:%S", std::localtime(&t));
#endif
        return std::string(buf);
    }

    void render_dashboard(const FVec& v) {
        std::cout << "\033[H" << std::flush;

        std::cout << "\033[1;36m================================================================================\033[0m\n";
        std::cout << "\033[1;36mHFT MARKET MICROSTRUCTURE & FEATURE PIPELINE\033[0m\n";
        std::cout << "\033[1;36m================================================================================\033[0m\n";

        std::cout << "  STATUS: \033[1;32mRUNNING\033[0m | DEPTH EVENTS: " << depth_count
                  << " | TRADES: " << trade_count
                  << " | TIME: " << get_current_time_str() << "\n";

        double bid = lob->b_bid();
        double ask = lob->b_ask();
        double b_vol = lob->b_vol();
        double a_vol = lob->a_vol();
        double spread = lob->spread();
        double mid = (ask + bid) / 2.0;

        std::cout << "  BEST BID: \033[1;32m" << pad_right(format_double(bid, 2), 10)
                  << " (Qty: " << pad_right(format_double(b_vol, 3), 7) << ")\033[0m | "
                  << "BEST ASK: \033[1;31m" << pad_right(format_double(ask, 2), 10)
                  << " (Qty: " << pad_right(format_double(a_vol, 3), 7) << ")\033[0m\n";
        std::cout << "  SPREAD:   \033[1;33m" << pad_right(format_double(spread, 2), 10) << "\033[0m"
                  << "           | MID PRICE: \033[1;35m" << pad_right(format_double(mid, 2), 10) << "\033[0m\n";
        std::cout << "  DEPTH:    BIDS=" << lob->bid_depth() << " ASKS=" << lob->ask_depth()
                  << " | INVALID UPDATES=" << lob->invalid_updates()
                  << " | CROSSED FIXES=" << lob->crossed_books()
                  << " | RESYNC COUNT=" << lob->resyncs() << "\n";
        if (!lob->warning().empty()) {
            std::cout << "  BOOK NOTE: " << lob->warning() << "\n";
        }

        std::cout << "\033[34m--------------------------------------------------------------------------------\033[0m\n";
        std::cout << "                     \033[1mLIVE MICROSTRUCTURE FEATURE VECTOR\033[0m\n";
        std::cout << "\033[34m--------------------------------------------------------------------------------\033[0m\n";
        std::cout << "  FEATURE NAME   |      VALUE     |      SIGNAL      |  DESCRIPTION\n";
        std::cout << "-----------------+----------------+------------------+---------------------------------\n";

        std::vector<std::string> keys = fe ? fe->feature_names() : std::vector<std::string>();
        for (const auto& key : keys) {
            double val = 0.0;
            auto it = v.find(key);
            if (it != v.end()) val = it->second;

            auto prev_it = last_features.find(key);
            bool has_prev = prev_it != last_features.end();
            double prev = has_prev ? prev_it->second : val;
            std::string signal = interpret_feature(key, val, prev, has_prev);
            last_features[key] = val;

            std::cout << "  " << pad_right(key, 15) << "| "
                      << pad_right(format_val(key, val), 15) << "| "
                      << pad_right(signal, 17) << "| "
                      << pad_right(fe ? fe->feature_desc(key) : "", 32) << "\n";
        }

        std::cout << "\033[34m--------------------------------------------------------------------------------\033[0m\n";
        std::cout << "                     \033[1mLIMIT ORDER BOOK TOP 5 LEVELS\033[0m\n";
        std::cout << "\033[34m--------------------------------------------------------------------------------\033[0m\n";
        std::cout << "        BIDS (Price | Size)               |        ASKS (Price | Size)          \n";
        std::cout << "------------------------------------------+-------------------------------------\n";

        auto bids = lob->get_b();
        auto asks = lob->get_a();
        auto b_it = bids.begin();
        auto a_it = asks.begin();

        for (int i = 0; i < 5; ++i) {
            std::string bid_str = "                   -";
            std::string ask_str = "-                  ";

            if (b_it != bids.end()) {
                std::stringstream ss;
                ss << std::fixed << std::setprecision(2) << b_it->first << " | " << std::setprecision(3) << b_it->second;
                bid_str = ss.str();
                b_it++;
            }
            if (a_it != asks.end()) {
                std::stringstream ss;
                ss << std::fixed << std::setprecision(2) << a_it->first << " | " << std::setprecision(3) << a_it->second;
                ask_str = ss.str();
                a_it++;
            }

            std::cout << "  " << pad_left(bid_str, 38) << "  |  " << pad_right(ask_str, 37) << "\n";
        }

        std::cout << "\033[1;36m================================================================================\033[0m\n";
        std::cout << "\033[J" << std::flush;
    }

    void render_json(const FVec& v) {
        json j;
        j["status"] = "RUNNING";
        j["depth_events"] = depth_count;
        j["trades"] = trade_count;
        j["time"] = get_current_time_str();

        double bid = lob->b_bid();
        double ask = lob->b_ask();
        double b_vol = lob->b_vol();
        double a_vol = lob->a_vol();
        double spread = lob->spread();
        double mid = (ask + bid) / 2.0;

        j["best_bid"] = bid;
        j["best_bid_qty"] = b_vol;
        j["best_ask"] = ask;
        j["best_ask_qty"] = a_vol;
        j["spread"] = spread;
        j["mid_price"] = mid;
        j["bids_depth"] = lob->bid_depth();
        j["asks_depth"] = lob->ask_depth();
        j["invalid_updates"] = lob->invalid_updates();
        j["crossed_fixes"] = lob->crossed_books();
        j["resync_count"] = lob->resyncs();
        j["is_synchronized"] = lob->is_sync();
        j["warning"] = lob->warning();

        json features_json = json::object();
        std::vector<std::string> keys = fe ? fe->feature_names() : std::vector<std::string>();
        for (const auto& key : keys) {
            double val = 0.0;
            auto it = v.find(key);
            if (it != v.end()) val = it->second;

            auto prev_it = last_features.find(key);
            bool has_prev = prev_it != last_features.end();
            double prev = has_prev ? prev_it->second : val;
            std::string signal = interpret_feature(key, val, prev, has_prev);
            last_features[key] = val;

            json feat;
            feat["value"] = val;
            feat["formatted_value"] = format_val(key, val);
            feat["signal"] = signal;
            feat["description"] = fe ? fe->feature_desc(key) : "";
            features_json[key] = feat;
        }
        j["features"] = features_json;

        json bids_json = json::array();
        auto bids = lob->get_b();
        auto b_it = bids.begin();
        for (int i = 0; i < 10 && b_it != bids.end(); ++i, ++b_it) {
            bids_json.push_back({b_it->first, b_it->second});
        }
        j["bids"] = bids_json;

        json asks_json = json::array();
        auto asks = lob->get_a();
        auto a_it = asks.begin();
        for (int i = 0; i < 10 && a_it != asks.end(); ++i, ++a_it) {
            asks_json.push_back({a_it->first, a_it->second});
        }
        j["asks"] = asks_json;

        std::cout << j.dump() << "\n" << std::flush;
    }

public:
    MarketHandler(LimitOrderBook* l, FeatureEngine* f, bool json_m = false)
        : lob(l), fe(f), json_mode(json_m), last_render(std::chrono::steady_clock::now()) {}

    bool needs_rebootstrap() override {
        return lob ? lob->needs_rebootstrap() : false;
    }

    void reset_sync() override {
        if (lob) lob->reset_sync();
    }

    void on_trd(const TradeEvent& e) override {
        trade_count++;
        if (fe) fe->add_trd(e);
    }

    void on_dpth(const DepthEvent& e) override {
        depth_count++;
        if (lob) lob->upd_depth(e);

        if (fe && lob && lob->ready()) {
            FVec v = fe->get_fvec();

            auto now = std::chrono::steady_clock::now();
            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - last_render).count();
            if (elapsed >= 200) {
                if (json_mode) {
                    render_json(v);
                } else {
                    render_dashboard(v);
                }
                last_render = now;
            }
        }
    }
};
