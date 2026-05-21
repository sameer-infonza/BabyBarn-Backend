#!/usr/bin/env bash
set -euo pipefail
BRANCH="${1:-master}"
git rm --cached -f .env .env.local .env.production 2>/dev/null || true
git fetch origin "${BRANCH}"
git reset --hard "origin/${BRANCH}"
git clean -fd -e .env -e '.env.*' -e uploads || true
git status -sb
