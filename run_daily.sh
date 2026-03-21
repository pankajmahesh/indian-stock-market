#!/bin/bash
# Daily pipeline runner — scheduled at 9:00 AM Mon–Fri
# Add to system crontab: crontab -e
#   0 9 * * 1-5 /Users/pankajmaheshwari/Desktop/Code/indian-stock-screener/run_daily.sh

set -e
DIR="/Users/pankajmaheshwari/Desktop/Code/indian-stock-screener"
LOG="$DIR/data/logs/daily_run_$(date +%Y%m%d).log"
mkdir -p "$DIR/data/logs"

echo "=== $(date) — Starting daily pipeline ===" | tee -a "$LOG"

cd "$DIR"

# Step 1-7: Full pipeline
python3 main.py 2>&1 | tee -a "$LOG"

echo "=== Pipeline complete. Triggering portfolio rebalance... ===" | tee -a "$LOG"

# Rebalance all portfolios via API (if server is running)
for PF in main sharekhan midcap150 largemidcap250 smallcap250; do
  curl -s -X POST http://127.0.0.1:5001/api/portfolio/scan \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$PF\",\"skip_cache\":true}" >> "$LOG" 2>&1 && \
  echo "" >> "$LOG" && \
  echo "  Triggered rebalance: $PF" | tee -a "$LOG"
done

# Regenerate daily report
curl -s -X POST http://127.0.0.1:5001/api/daily-report/generate >> "$LOG" 2>&1

echo "=== $(date) — All done ===" | tee -a "$LOG"
