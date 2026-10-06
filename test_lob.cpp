#include <iostream>
#include <cassert>
#include <cmath>
#include "LimitOrderBookEngine.h"

// Basic assert macro helper that prints progress
#define ASSERT_TEST(condition, message) \
    do { \
        if (!(condition)) { \
            std::cerr << "Assertion failed: " << message << " at line " << __LINE__ << std::endl; \
            exit(1); \
        } \
    } while (0)

void test_bid_ask_ordering() {
    LimitOrderBook lob;
    
    // Simulate snapshot
    DepthEvent snap;
    snap.is_snapshot = true;
    snap.uid = 1000;
    snap.b.push_back({100.0, 1.5});
    snap.b.push_back({99.0, 2.0});
    snap.b.push_back({101.0, 0.5}); // Unsorted input to verify LOB engine sorts
    
    snap.a.push_back({105.0, 3.0});
    snap.a.push_back({104.0, 1.0});
    snap.a.push_back({106.0, 2.5}); // Unsorted input to verify LOB engine sorts
    
    lob.upd_depth(snap);
    
    ASSERT_TEST(lob.is_sync() == true, "LOB should be synchronized after snapshot");
    ASSERT_TEST(lob.b_bid() == 101.0, "Best bid should be 101.0");
    ASSERT_TEST(lob.b_ask() == 104.0, "Best ask should be 104.0");
    ASSERT_TEST(lob.spread() == 3.0, "Spread should be 3.0");
    
    // Check descending sorting of bids
    auto bids = lob.get_b();
    auto b_it = bids.begin();
    double last_price = 999999.9;
    for (; b_it != bids.end(); ++b_it) {
        ASSERT_TEST(b_it->first < last_price, "Bids should be sorted in descending order");
        last_price = b_it->first;
    }
    
    // Check ascending sorting of asks
    auto asks = lob.get_a();
    auto a_it = asks.begin();
    last_price = -1.0;
    for (; a_it != asks.end(); ++a_it) {
        ASSERT_TEST(a_it->first > last_price, "Asks should be sorted in ascending order");
        last_price = a_it->first;
    }
    
    std::cout << "[PASS] test_bid_ask_ordering" << std::endl;
}

void test_zero_quantity_removal() {
    LimitOrderBook lob;
    
    DepthEvent snap;
    snap.is_snapshot = true;
    snap.uid = 1000;
    snap.b.push_back({100.0, 1.0});
    snap.b.push_back({99.0, 2.0});
    snap.a.push_back({105.0, 3.0});
    snap.a.push_back({106.0, 4.0});
    lob.upd_depth(snap);
    
    ASSERT_TEST(lob.bid_depth() == 2, "Bids depth should be 2");
    ASSERT_TEST(lob.ask_depth() == 2, "Asks depth should be 2");
    
    // Delete 99.0 bid and 105.0 ask
    DepthEvent inc;
    inc.is_snapshot = false;
    inc.first_update_id = 1001;
    inc.uid = 1001;
    inc.b.push_back({99.0, 0.0});
    inc.a.push_back({105.0, 0.0});
    lob.upd_depth(inc);
    
    ASSERT_TEST(lob.bid_depth() == 1, "Bids depth should now be 1");
    ASSERT_TEST(lob.ask_depth() == 1, "Asks depth should now be 1");
    ASSERT_TEST(lob.b_bid() == 100.0, "Best bid should be 100.0");
    ASSERT_TEST(lob.b_ask() == 106.0, "Best ask should be 106.0");
    
    std::cout << "[PASS] test_zero_quantity_removal" << std::endl;
}

void test_crossed_book_correction() {
    LimitOrderBook lob;
    
    DepthEvent snap;
    snap.is_snapshot = true;
    snap.uid = 1000;
    snap.b.push_back({100.0, 1.0});
    snap.a.push_back({105.0, 2.0});
    lob.upd_depth(snap);
    
    ASSERT_TEST(lob.crossed_books() == 0, "No crossed books initially");
    
    // Inject crossed bid at 106.0 (which crosses the 105.0 ask)
    DepthEvent inc;
    inc.is_snapshot = false;
    inc.first_update_id = 1001;
    inc.uid = 1001;
    inc.b.push_back({106.0, 1.5});
    lob.upd_depth(inc);
    
    // Correction should occur: best bid (106.0) >= best ask (105.0).
    // The engine removes conflicting top levels.
    // 106.0 bid is inserted, then consistency deletes 106.0 bid (since it crosses 105.0 ask)
    // Verify that the crossed fixes counter is incremented and the book remains uncrossed.
    ASSERT_TEST(lob.crossed_books() > 0, "Crossed fixes should be incremented");
    ASSERT_TEST(lob.b_bid() < lob.b_ask(), "Book should not remain crossed");
    
    std::cout << "[PASS] test_crossed_book_correction" << std::endl;
}

void test_sequencing_and_gap_detection() {
    LimitOrderBook lob;
    
    DepthEvent snap;
    snap.is_snapshot = true;
    snap.uid = 1000;
    snap.b.push_back({100.0, 1.0});
    snap.a.push_back({105.0, 1.0});
    lob.upd_depth(snap);
    
    // 1. Check out of order early event (ignored if older, triggers rebootstrap if gap)
    // Normal event U <= lastUpdateId + 1 and u >= lastUpdateId + 1
    DepthEvent inc1;
    inc1.is_snapshot = false;
    inc1.first_update_id = 990;
    inc1.uid = 1002; // overlaps 1001
    lob.upd_depth(inc1);
    ASSERT_TEST(lob.needs_rebootstrap() == false, "No restart needed for valid overlap first event");
    
    // 2. Normal progression: U == previous_u + 1
    // previous_u is now 1002. Expect U = 1003.
    DepthEvent inc2;
    inc2.is_snapshot = false;
    inc2.first_update_id = 1003;
    inc2.uid = 1010;
    lob.upd_depth(inc2);
    ASSERT_TEST(lob.needs_rebootstrap() == false, "No restart needed for normal sequence progression");
    
    // 3. Gap detection: expect U = 1011. Send U = 1015 instead.
    DepthEvent inc3;
    inc3.is_snapshot = false;
    inc3.first_update_id = 1015; // gap!
    inc3.uid = 1020;
    lob.upd_depth(inc3);
    
    ASSERT_TEST(lob.needs_rebootstrap() == true, "Sequencing gap should trigger rebootstrap flag");
    ASSERT_TEST(lob.resyncs() == 1, "Resync count should be 1");
    ASSERT_TEST(lob.is_sync() == false, "LOB should show unsynchronized state");
    
    // 4. Test LOB Reset
    lob.reset_sync();
    ASSERT_TEST(lob.needs_rebootstrap() == false, "Rebootstrap flag should clear on reset");
    ASSERT_TEST(lob.is_sync() == false, "LOB should still be unsynchronized until next snapshot");
    
    std::cout << "[PASS] test_sequencing_and_gap_detection" << std::endl;
}

int main() {
    std::cout << "Starting LimitOrderBookEngine C++ Unit Tests..." << std::endl;
    
    test_bid_ask_ordering();
    test_zero_quantity_removal();
    test_crossed_book_correction();
    test_sequencing_and_gap_detection();
    
    std::cout << "All LimitOrderBookEngine C++ Unit Tests Passed Successfully!" << std::endl;
    return 0;
}
