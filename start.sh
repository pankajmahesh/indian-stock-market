#!/bin/bash
# Start both the Flask API server and React dev server

echo "========================================="
echo "  Indian Stock Screener - Full Stack"
echo "========================================="
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if data exists
if [ ! -f "$DIR/data/output/final_top20.csv" ]; then
    echo "WARNING: No screener data found."
    echo "Run the pipeline first:  python3 main.py"
    echo ""
fi

# Start Flask API in background
echo "Starting Flask API server on http://127.0.0.1:5001 ..."
cd "$DIR" && python3 api_server.py &
API_PID=$!

# Wait for API to start
sleep 2

# Start React dev server
echo "Starting React dev server on http://localhost:3000 ..."
cd "$DIR/frontend" && npm run dev &
REACT_PID=$!

echo ""
echo "========================================="
echo "  API:   http://127.0.0.1:5001/api/summary"
echo "  UI:    http://localhost:3000"
echo "========================================="
echo ""
echo "Press Ctrl+C to stop both servers"

# Trap Ctrl+C to kill both processes
trap "kill $API_PID $REACT_PID 2>/dev/null; exit" INT TERM
wait
