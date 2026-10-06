#pragma once
#include <map>
#include <string>
#include <cstdint>
#include <cstddef>
#include <functional>
#include <iostream>
#include "types.h"

class LimitOrderBook {
private:
    std::map<double, double, std::greater<double>> b_map; 
    std::map<double, double, std::less<double>> a_map;
    bool is_init = false;

    // Sequencing state
    bool is_synchronized = false;
    bool is_first_update = true;
    int64_t last_update_id = -1;
    bool rebootstrap_requested = false;
    uint64_t resync_count = 0;

    // Validation stats
    uint64_t invalid_update_count = 0;
    uint64_t crossed_book_count = 0;
    std::string last_warning;

    // Simulation
    bool simulate_gap = false;
    int depth_updates_processed = 0;

    void init_snap(const DepthEvent& e) {
        b_map.clear();
        a_map.clear();
        for (const auto& x : e.b) {
            if (x.p <= 0 || x.s < 0) {
                invalid_update_count++;
                last_warning = "Invalid bid level ignored during snapshot init";
                continue;
            }
            if (x.s > 0) b_map[x.p] = x.s;
        }
        for (const auto& x : e.a) {
            if (x.p <= 0 || x.s < 0) {
                invalid_update_count++;
                last_warning = "Invalid ask level ignored during snapshot init";
                continue;
            }
            if (x.s > 0) a_map[x.p] = x.s;
        }
        is_init = true;
        is_synchronized = true;
        is_first_update = true;
        last_update_id = e.uid;
        rebootstrap_requested = false;
        enforce_consistency();
        std::cerr << "[LOB] Bootstrapped book from REST snapshot. lastUpdateId: " << last_update_id << "\n";
    }

    void trigger_rebootstrap(const std::string& reason) {
        std::cerr << "[LOB ERROR] " << reason << ". Triggering re-bootstrap...\n";
        rebootstrap_requested = true;
        is_synchronized = false;
        resync_count++;
        last_warning = reason;
        depth_updates_processed = 0; // Reset for simulation
    }

    void apply_inc_levels(const DepthEvent& e) {
        for (const auto& x : e.b) {
            if (x.p <= 0 || x.s < 0) {
                invalid_update_count++;
                last_warning = "Invalid bid update ignored";
                continue;
            }
            if (x.s == 0) b_map.erase(x.p);
            else b_map[x.p] = x.s;
        }
        for (const auto& x : e.a) {
            if (x.p <= 0 || x.s < 0) {
                invalid_update_count++;
                last_warning = "Invalid ask update ignored";
                continue;
            }
            if (x.s == 0) a_map.erase(x.p);
            else a_map[x.p] = x.s;
        }
        enforce_consistency();
    }

    void apply_inc(const DepthEvent& e) {
        if (is_first_update) {
            // First update: U <= lastUpdateId + 1 and u >= lastUpdateId + 1
            if (e.first_update_id <= last_update_id + 1 && e.uid >= last_update_id + 1) {
                is_first_update = false;
                apply_inc_levels(e);
                last_update_id = e.uid;
            } else {
                if (e.uid < last_update_id + 1) {
                    // Old update, ignore it
                    return;
                }
                trigger_rebootstrap("Missed start event during synchronization");
            }
        } else {
            // Subsequent updates: U == previous_u + 1
            if (e.first_update_id == last_update_id + 1) {
                apply_inc_levels(e);
                last_update_id = e.uid;
            } else {
                std::string msg = "Sequencing gap: expected U=" + std::to_string(last_update_id + 1) + ", got U=" + std::to_string(e.first_update_id);
                trigger_rebootstrap(msg);
            }
        }
    }

    void enforce_consistency() {
        if (b_map.empty() || a_map.empty()) {
            last_warning = "One side of the book is empty";
            return;
        }

        bool corrected_cross = false;
        while (!b_map.empty() && !a_map.empty() && b_map.begin()->first >= a_map.begin()->first) {
            crossed_book_count++;
            corrected_cross = true;
            last_warning = "Crossed book corrected by removing conflicting top levels";

            if (b_map.begin()->first == a_map.begin()->first) {
                b_map.erase(b_map.begin());
                a_map.erase(a_map.begin());
            } else {
                b_map.erase(b_map.begin());
            }
        }

        if (b_map.empty() || a_map.empty()) {
            last_warning = "One side of the book is empty";
        } else if (!corrected_cross) {
            last_warning.clear();
        }
    }

public:
    void upd_depth(const DepthEvent& e) {
        if (e.is_snapshot) {
            init_snap(e);
            return;
        }

        if (!is_synchronized) {
            // Discard depth updates until synchronized
            return;
        }

        if (simulate_gap && is_synchronized && !rebootstrap_requested) {
            depth_updates_processed++;
            if (depth_updates_processed == 10) {
                DepthEvent gap_event = e;
                gap_event.first_update_id = last_update_id + 9999; // intentionally mismatched U
                std::cerr << "[SIMULATION] Injecting sequencing gap for verification...\n";
                apply_inc(gap_event);
                return;
            }
        }

        apply_inc(e);
    }

    void reset_sync() {
        is_init = false;
        is_synchronized = false;
        is_first_update = true;
        rebootstrap_requested = false;
        b_map.clear();
        a_map.clear();
        depth_updates_processed = 0;
        std::cerr << "[LOB] Order book synchronization state has been reset.\n";
    }

    bool needs_rebootstrap() const { return rebootstrap_requested; }
    uint64_t resyncs() const { return resync_count; }
    void set_simulate_gap(bool sim) { simulate_gap = sim; }
    bool is_sync() const { return is_synchronized; }

    double b_bid() const { return b_map.empty() ? 0.0 : b_map.begin()->first; }
    double b_ask() const { return a_map.empty() ? 0.0 : a_map.begin()->first; }
    double b_vol() const { return b_map.empty() ? 0.0 : b_map.begin()->second; }
    double a_vol() const { return a_map.empty() ? 0.0 : a_map.begin()->second; }
    bool ready() const { return !b_map.empty() && !a_map.empty() && b_bid() < b_ask(); }
    double spread() const { return ready() ? b_ask() - b_bid() : 0.0; }
    size_t bid_depth() const { return b_map.size(); }
    size_t ask_depth() const { return a_map.size(); }
    uint64_t invalid_updates() const { return invalid_update_count; }
    uint64_t crossed_books() const { return crossed_book_count; }
    const std::string& warning() const { return last_warning; }

    const std::map<double, double, std::greater<double>>& get_b() const { return b_map; }
    const std::map<double, double, std::less<double>>& get_a() const { return a_map; }
};
