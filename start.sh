#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}🌿 Leaf — Starting...${NC}\n"

# --- PostgreSQL ---
if ! /opt/homebrew/opt/postgresql@16/bin/pg_isready -q 2>/dev/null; then
  echo -e "${YELLOW}→ Starting PostgreSQL...${NC}"
  brew services start postgresql@16
  sleep 2
fi
echo -e "${GREEN}✓ PostgreSQL running${NC}"

# --- Kill old processes ---
pkill -f "leaf-server" 2>/dev/null || true
pkill -f "next" 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:8080 | xargs kill -9 2>/dev/null || true
sleep 1

# --- Backend ---
echo -e "${YELLOW}→ Building backend...${NC}"
cd "$ROOT/backend"
go build -o leaf-server . > /tmp/leaf-backend-build.log 2>&1 || { echo -e "${RED}✗ Backend build failed! Check /tmp/leaf-backend-build.log${NC}"; exit 1; }
echo -e "${YELLOW}→ Starting backend...${NC}"
./leaf-server > /tmp/leaf-backend.log 2>&1 &
BACKEND_PID=$!

# Wait for backend
for i in {1..15}; do
  if curl -s http://localhost:8080/health > /dev/null 2>&1; then
    break
  fi
  sleep 1
done
echo -e "${GREEN}✓ Backend running (PID $BACKEND_PID) → http://localhost:8080${NC}"

# --- Frontend ---
echo -e "${YELLOW}→ Building frontend...${NC}"
cd "$ROOT/frontend"
npm run build > /tmp/leaf-frontend-build.log 2>&1
echo -e "${YELLOW}→ Starting frontend...${NC}"
npm start > /tmp/leaf-frontend.log 2>&1 &
FRONTEND_PID=$!
sleep 3
echo -e "${GREEN}✓ Frontend running (PID $FRONTEND_PID) → http://localhost:3000${NC}"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🌿 Leaf is running!${NC}"
echo -e "   UI:  ${BLUE}http://localhost:3000${NC}"
echo -e "   API: ${BLUE}http://localhost:8080${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "Logs: ${YELLOW}tail -f /tmp/leaf-backend.log /tmp/leaf-frontend.log${NC}"
echo -e "Stop: ${YELLOW}./stop.sh${NC}"

# Open browser
sleep 2
open http://localhost:3000
