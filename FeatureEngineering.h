#pragma once
#include <deque>
#include <cmath>
#include <vector>
#include <string>
#include <functional>
#include <unordered_map>
#include "types.h"
#include "LimitOrderBookEngine.h"

class FeatureEngine {
private:
    LimitOrderBook* lob;
    std::deque<TradeEvent> trds;
    std::deque<double> mp_hist;   // rolling mid-price buffer for momentum/volatility features

    // Extracted state for some features
    double p_bb = 0, p_ba = 0, p_bv = 0, p_av = 0;
    
    struct FeatureSpec {
        std::string name;
        std::string desc;
        std::function<double()> compute;
    };

    std::vector<FeatureSpec> feature_registry;
    std::unordered_map<std::string, std::string> feature_descriptions;

    template <typename T>
    double c_mu(const T& m, int n) {
        double sw = 0, sp = 0;
        int c = 0;
        for (const auto& pair : m) {
            if (c++ >= n) break;
            sp += pair.first * pair.second;
            sw += pair.second;
        }
        return sw > 0 ? sp / sw : 0;
    }

    template <typename T>
    double c_sig(const T& m, int n, double mu) {
        double sw = 0, sv = 0;
        int c = 0;
        for (const auto& pair : m) {
            if (c++ >= n) break;
            sv += std::pow(pair.first - mu, 2) * pair.second;
            sw += pair.second;
        }
        return sw > 0 ? std::sqrt(sv / sw) : 0;
    }

    template <typename T>
    double c_skw(const T& m, int n, double mu, double sig) {
        if (sig == 0) return 0;
        double sw = 0, sk = 0;
        int c = 0;
        for (const auto& pair : m) {
            if (c++ >= n) break;
            sk += std::pow(pair.first - mu, 3) * pair.second;
            sw += pair.second;
        }
        return sw > 0 ? sk / (sw * std::pow(sig, 3)) : 0;
    }

    double c_vwap() {
        double sv = 0, sp = 0;
        for (const auto& t : trds) {
            sp += t.p * t.q;
            sv += t.q;
        }
        return sv > 0 ? sp / sv : 0;
    }

    double c_ofi(double bb, double ba, double bv, double av) {
        double db = 0, da = 0;
        
        if (bb >= p_bb) db = (bb == p_bb) ? bv - p_bv : bv;
        else db = -p_bv;

        if (ba <= p_ba) da = (ba == p_ba) ? av - p_av : av;
        else da = -p_av;

        p_bb = bb; p_ba = ba; p_bv = bv; p_av = av;
        return db - da;
    }

    void cln_trds(int64_t now, int64_t w) {
        while (!trds.empty() && now - trds.front().ts > w) {
            trds.pop_front();
        }
    }

    void register_feature(const std::string& name, const std::string& desc, std::function<double()> func) {
        feature_registry.push_back({name, desc, func});
        feature_descriptions[name] = desc;
    }

    void init_features() {
        // -------------------------------------------------------------
        // AUTOMATED FEATURE PIPELINE
        // Want to add a new feature? Just register it below! 
        // No changes needed in types.h or anywhere else.
        // -------------------------------------------------------------
        

        register_feature("obi", "Order Book Imbalance", [this]() {
            double bv = lob->b_vol(), av = lob->a_vol();
            return (bv + av > 0) ? (bv - av) / (bv + av) : 0;
        });

        register_feature("ofi", "Order Flow Imbalance", [this]() {
            return c_ofi(lob->b_bid(), lob->b_ask(), lob->b_vol(), lob->a_vol());
        });register_feature("spr", "Bid-Ask Spread", [this]() {
            return lob->spread();
        });

        register_feature("mp", "Mid-Price", [this]() {
            return (lob->b_ask() + lob->b_bid()) / 2.0;
        });

        register_feature("mcp", "Micro-Price", [this]() {
            double bb = lob->b_bid(), ba = lob->b_ask();
            double bv = lob->b_vol(), av = lob->a_vol();
            return (bv + av > 0) ? (bb * av + ba * bv) / (bv + av) : (ba + bb) / 2.0;
        });

        register_feature("ti", "Trade Imbalance (1s Window)", [this]() {
            double tv_b = 0, tv_s = 0;
            for (const auto& t : trds) {
                if (t.is_buy) tv_b += t.q;
                else tv_s += t.q;
            }
            return (tv_b + tv_s > 0) ? (tv_b - tv_s) / (tv_b + tv_s) : 0;
        });

        register_feature("tr", "Trade Rate (Trades/sec)", [this]() {
            return static_cast<double>(trds.size());
        });

        register_feature("vwap_d", "VWAP Deviation", [this]() {
            double vwap = c_vwap();
            double mp = (lob->b_ask() + lob->b_bid()) / 2.0;
            return (vwap > 0) ? mp - vwap : 0;
        });

        register_feature("b_sw", "Bid Skewness (Top 10 Levels)", [this]() {
            const int dpth = 10;
            double b_mu = c_mu(lob->get_b(), dpth);
            double b_sig = c_sig(lob->get_b(), dpth, b_mu);
            return c_skw(lob->get_b(), dpth, b_mu, b_sig);
        });

        register_feature("a_sw", "Ask Skewness (Top 10 Levels)", [this]() {
            const int dpth = 10;
            double a_mu = c_mu(lob->get_a(), dpth);
            double a_sig = c_sig(lob->get_a(), dpth, a_mu);
            return c_skw(lob->get_a(), dpth, a_mu, a_sig);
        });

        // Depth-Weighted Imbalance: exponentially-weighted OBI across top 5 levels
        // Weight decays by 0.65 per level — nearer levels have stronger predictive power
        register_feature("dwi", "Depth-Weighted Imbalance (5 Levels)", [this]() {
            const int N = 5;
            double num = 0.0, den = 0.0, w = 1.0;
            const double decay = 0.65;
            const auto& bids = lob->get_b();
            const auto& asks = lob->get_a();
            auto bi = bids.begin(), ai = asks.begin();
            for (int i = 0; i < N; i++) {
                double bv = (bi != bids.end()) ? bi->second : 0.0;
                double av = (ai != asks.end()) ? ai->second : 0.0;
                double tot = bv + av;
                if (tot > 0.0) { num += w * (bv - av); den += w * tot; }
                if (bi != bids.end()) ++bi;
                if (ai != asks.end()) ++ai;
                w *= decay;
            }
            return den > 0.0 ? num / den : 0.0;
        });

        // Price Momentum: cumulative mid-price drift over rolling 40-tick window (in bps)
        register_feature("momo", "Price Momentum (40-Tick Window, bps)", [this]() {
            if (mp_hist.size() < 5) return 0.0;
            double oldest = mp_hist.front(), newest = mp_hist.back();
            return oldest > 0.0 ? (newest - oldest) / oldest * 10000.0 : 0.0;
        });

        // Realized Volatility: std dev of tick-to-tick returns over rolling 40-tick window (in bps)
        register_feature("pvol", "Realized Volatility (40-Tick Window, bps)", [this]() {
            if (mp_hist.size() < 5) return 0.0;
            std::vector<double> rets;
            rets.reserve(mp_hist.size() - 1);
            for (size_t i = 1; i < mp_hist.size(); ++i) {
                if (mp_hist[i-1] > 0.0)
                    rets.push_back((mp_hist[i] - mp_hist[i-1]) / mp_hist[i-1] * 10000.0);
            }
            if (rets.empty()) return 0.0;
            double mean = 0.0;
            for (double r : rets) mean += r;
            mean /= static_cast<double>(rets.size());
            double var = 0.0;
            for (double r : rets) var += (r - mean) * (r - mean);
            return std::sqrt(var / static_cast<double>(rets.size()));
        });
    }

public:
    FeatureEngine(LimitOrderBook* l) : lob(l) {
        init_features();
    }

    void add_trd(const TradeEvent& t) {
        trds.push_back(t);
        cln_trds(t.ts, 1000); 
    }

    std::vector<std::string> feature_names() const {
        std::vector<std::string> names;
        for (const auto& feature : feature_registry) {
            names.push_back(feature.name);
        }
        return names;
    }

    std::string feature_desc(const std::string& name) const {
        auto it = feature_descriptions.find(name);
        return it != feature_descriptions.end() ? it->second : "";
    }

    FVec get_fvec() {
        FVec f;
        if (!lob->ready()) return f;

        // Update rolling mid-price history (used by momo and pvol features)
        double cur_mp = (lob->b_bid() + lob->b_ask()) / 2.0;
        mp_hist.push_back(cur_mp);
        if (mp_hist.size() > 40) mp_hist.pop_front();

        // Automatically compute all registered features
        for (const auto& feature : feature_registry) {
            f[feature.name] = feature.compute();
        }

        return f;
    }
};
