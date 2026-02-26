#!/bin/bash
echo "🛑 Stopping Leaf..."
pkill -f "leaf-server" 2>/dev/null && echo "✓ Backend stopped" || echo "  Backend was not running"
pkill -f "next" 2>/dev/null && echo "✓ Frontend stopped" || echo "  Frontend was not running"
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:8080 | xargs kill -9 2>/dev/null || true
echo "Done."
