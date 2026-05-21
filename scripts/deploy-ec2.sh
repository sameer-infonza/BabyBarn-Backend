#!/usr/bin/env bash
# Run on EC2 after git pull (invoked by GitHub Actions or manually).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "ERROR: $ROOT/.env is missing. Copy .env.example and configure production values before deploying."
  exit 1
fi

echo "==> Deploying Baby Barn API from $ROOT"
git fetch origin master
git reset --hard origin/master

npm ci
npx prisma generate
npx prisma migrate deploy

if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe babybarn-api >/dev/null 2>&1; then
    pm2 restart babybarn-api --update-env
  else
    pm2 start ecosystem.config.cjs --env production
    pm2 save
  fi
  pm2 status babybarn-api
else
  echo "WARN: pm2 not installed. Restart the API process manually (systemd or node index.js)."
fi

echo "==> Backend deploy complete"
