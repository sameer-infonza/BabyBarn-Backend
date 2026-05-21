#!/usr/bin/env bash
# One-time Ubuntu EC2 setup for Baby Barn (run as deploy user with sudo).
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
WWW_ROOT="/var/www"

echo "==> Installing Node.js 22 + git + PM2"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get update -y
sudo apt-get install -y git nginx
sudo npm install -g pm2

echo "==> Creating ${WWW_ROOT}"
sudo mkdir -p "${WWW_ROOT}"
sudo chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${WWW_ROOT}"

clone_if_missing() {
  local name="$1"
  local repo="$2"
  local dir="${WWW_ROOT}/${name}"
  if [[ -d "${dir}/.git" ]]; then
    echo "Already cloned: ${dir}"
  else
    git clone "${repo}" "${dir}"
  fi
}

echo "==> Clone repositories (HTTPS — use deploy key or PAT if private)"
clone_if_missing "BabyBarn-Backend" "https://github.com/sameer-infonza/BabyBarn-Backend.git"
clone_if_missing "BabyBarn-Frontend" "https://github.com/sameer-infonza/BabyBarn-Frontend.git"
clone_if_missing "BabyBarn-Admin" "https://github.com/sameer-infonza/BabyBarn-Admin.git"

echo "==> Next steps (manual, on server):"
echo "  1. cp ${WWW_ROOT}/BabyBarn-Backend/.env.example ${WWW_ROOT}/BabyBarn-Backend/.env"
echo "  2. cp ${WWW_ROOT}/BabyBarn-Frontend/.env.example ${WWW_ROOT}/BabyBarn-Frontend/.env"
echo "  3. cp ${WWW_ROOT}/BabyBarn-Admin/.env.example ${WWW_ROOT}/BabyBarn-Admin/.env"
echo "  4. Edit each .env with production values (never commit .env)"
echo "  5. bash ${WWW_ROOT}/BabyBarn-Backend/deploy/deploy-backend.sh"
echo "  6. bash ${WWW_ROOT}/BabyBarn-Frontend/deploy/deploy-frontend.sh"
echo "  7. bash ${WWW_ROOT}/BabyBarn-Admin/deploy/deploy-admin.sh"
echo "  8. pm2 startup && pm2 save"
echo "  9. Configure Nginx — see docs/nginx/babybarn.conf in monorepo or repo docs"
