#!/bin/bash
# GitHub Push Helper Script for Gold Screener
# 
# Usage: Replace YOUR_VALID_GITHUB_TOKEN below and run:
#   bash push-to-github.sh YOUR_VALID_GITHUB_TOKEN
#
# The token needs: repo, public_repo scope

TOKEN="${1:-YOUR_VALID_GITHUB_TOKEN}"
REPO_NAME="gold-screener-xauusdt"
REPO_DESC="Real-time XAU/USDT 3-minute crypto screener with TradingView chart"

echo "Creating GitHub repository..."
RESPONSE=$(curl -s -X POST "https://api.github.com/user/repos" \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d "{\"name\":\"$REPO_NAME\",\"description\":\"$REPO_DESC\",\"private\":false}")

if echo "$RESPONSE" | grep -q "Bad credentials"; then
  echo "ERROR: Invalid GitHub token. Please provide a valid Personal Access Token."
  echo "Create one at: https://github.com/settings/tokens"
  exit 1
fi

echo "Repository created!"

echo "Pushing code..."
git remote set-url origin "https://x-access-token:${TOKEN}@github.com/$(curl -s -H "Authorization: token $TOKEN" https://api.github.com/user | grep '"login"' | head -1 | cut -d'"' -f4)/${REPO_NAME}.git"
git push -u origin main
echo "Done!"
