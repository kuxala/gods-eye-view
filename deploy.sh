#!/usr/bin/env bash
# Run on the VPS from ~/apps/gods-eye-view. Requires nvm Node 24 (build) and
# nvm Node 22 (pm2 is installed there, so `nvm use 24` drops it from PATH).
set -euo pipefail
cd "$(dirname "$0")"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null
git pull --ff-only
npm ci
npm run build
nvm exec 22 pm2 restart globe --update-env
nvm exec 22 pm2 save
