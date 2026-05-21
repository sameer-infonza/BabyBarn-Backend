#!/usr/bin/env bash
# Production deploy — BabyBarn-Backend (read-only server, port 5000)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

configure_deploy "BabyBarn-Backend" "babybarn-api" "5000" "backend"
run_deploy
