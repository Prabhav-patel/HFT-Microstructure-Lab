#pragma once
#include <string>
#include <cstdio>
#include <iostream>
#include "BinanceParser.h"

class ProcessDataFeed {
private:
    std::string command;
    BinanceParser& parser;
    bool json_mode;

public:
    ProcessDataFeed(const std::string& cmd, BinanceParser& p, bool json = false) 
        : command(cmd), parser(p), json_mode(json) {}

    void start() {
        // Clear screen and hide cursor for a clean dashboard view
        if (!json_mode) {
            std::cout << "\033[2J\033[H\033[?25l" << std::flush;
        }

        bool running = true;
        char buffer[8192];

        while (running) {
            FILE* pipe = _popen(command.c_str(), "r");
            if (!pipe) {
                std::cerr << "Failed to start data feed process: " << command << "\n";
                running = false;
                break;
            }

            std::string incomplete_message = "";
            bool restart_requested = false;

            while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
                incomplete_message += buffer;
                if (!incomplete_message.empty() && incomplete_message.back() == '\n') {
                    parser.parseMessage(incomplete_message);
                    incomplete_message.clear();

                    if (parser.needs_rebootstrap()) {
                        parser.reset_sync();
                        restart_requested = true;
                        break;
                    }
                }
            }

            _pclose(pipe);

            if (!restart_requested) {
                // If it exited normally without restart request (e.g. process terminated), stop
                running = false;
            } else {
                std::cerr << "[ProcessDataFeed] Gap detected. Restarting subprocess for re-bootstrap...\n";
            }
        }

        // Restore cursor on normal exit
        if (!json_mode) {
            std::cout << "\033[?25h" << std::flush;
        }
    }
};
