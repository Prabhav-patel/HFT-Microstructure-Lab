#pragma once
#include <vector>
#include <cstdint>

struct PriceLevel {
    double p;
    double s;
};

struct DepthEvent {
    bool is_snapshot = false;
    int64_t first_update_id = -1;
    int64_t uid;
    std::vector<PriceLevel> b;
    std::vector<PriceLevel> a;
};

struct TradeEvent {
    double p;
    double q;
    bool is_buy;
    int64_t ts;
};

#include <unordered_map>
#include <string>

using FVec = std::unordered_map<std::string, double>;