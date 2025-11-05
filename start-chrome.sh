#!/bin/bash

# Kill existing Chrome instances
pkill -f "Google Chrome" 2>/dev/null

echo "Starting Chrome with remote debugging..."
sleep 2

# Start Chrome with your real profile and remote debugging
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --restore-last-session \
  > /dev/null 2>&1 &

sleep 3
echo "Chrome started! You can now run: npm run dev"
