#!/bin/bash
cd /home/z/my-project
while true; do
    if ! curl -s -o /dev/null --max-time 3 http://localhost:3012/ 2>/dev/null; then
        echo "[$(date)] Server down, restarting..."
        pkill -f "node.*server" 2>/dev/null
        sleep 1
        NODE_ENV=production bun .next/standalone/server.js >> /tmp/next-server.log 2>&1 &
        sleep 5
        if curl -s -o /dev/null --max-time 3 http://localhost:3012/ 2>/dev/null; then
            echo "[$(date)] Server restarted successfully"
        else
            echo "[$(date)] Server restart failed"
        fi
    fi
    sleep 10
done
