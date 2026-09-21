#!/usr/bin/env bash
# Run on the VPS from ~/apps/gods-eye-view. Requires nvm Node 24 + pm2.
set -euo pipefail
cd "$(dirname "$0")"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null
git pull --ff-only
npm ci
npm run build
pm2 restart globe --update-env
pm2 save
