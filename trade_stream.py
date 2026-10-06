# pyrefly: ignore [missing-import]
import websocket
import json
import sys
import urllib.request
import threading
import queue
import os

socket = "wss://stream.binance.com:9443/stream?streams=btcusdt@trade/btcusdt@depth"

msg_queue = queue.Queue()
snapshot_fetched = False
snapshot_data = None

def safe_print(msg_str):
    try:
        print(msg_str)
        sys.stdout.flush()
    except (BrokenPipeError, IOError):
        # stdout is closed (C++ closed the pipe), exit immediately
        os._exit(0)

def fetch_snapshot():
    global snapshot_data, snapshot_fetched
    try:
        url = "https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=1000"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            snapshot_data = json.loads(response.read().decode())
            snapshot_fetched = True
    except Exception as e:
        sys.stderr.write(f"Error fetching snapshot: {e}\n")
        sys.stderr.flush()

def on_message(ws, message):
    global snapshot_fetched, snapshot_data
    if not snapshot_fetched:
        try:
            data = json.loads(message)
            msg_queue.put(data)
        except Exception as e:
            pass
    else:
        if snapshot_data is not None:
            # First, broadcast snapshot
            snapshot_msg = {
                "stream": "btcusdt@snapshot",
                "data": snapshot_data
            }
            safe_print(json.dumps(snapshot_msg))
            snapshot_data = None
            
            # Flush queue
            while not msg_queue.empty():
                safe_print(json.dumps(msg_queue.get()))
        
        # Broadcast live tick
        safe_print(message)

def on_open(ws):
    # Fetch REST snapshot in background thread
    threading.Thread(target=fetch_snapshot, daemon=True).start()

ws = websocket.WebSocketApp(socket, on_message=on_message, on_open=on_open)
ws.run_forever()