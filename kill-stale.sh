#!/bin/bash
# kill-stale.sh — run this from cPanel Terminal when app gets stuck
# Usage: bash ~/biometric-app/kill-stale.sh

echo "=== Current lsnode processes ==="
ps aux | grep lsnode | grep biometric | grep -v grep

echo ""
echo "=== Killing stale processes ==="
pkill -TERM -f "lsnode:/home/bifmein1/biometric-app" && echo "Sent SIGTERM to all lsnode biometric processes" || echo "No processes found to kill"

sleep 2

# Force kill anything remaining
pkill -KILL -f "lsnode:/home/bifmein1/biometric-app" 2>/dev/null

echo ""
echo "=== Processes after kill ==="
ps aux | grep lsnode | grep biometric | grep -v grep || echo "None — all clear"

echo ""
echo "Done. Now restart the app from cPanel → Setup Node.js App → Start"