#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
git status
read -r -p "Commit message [Update TypeRush]: " MSG
MSG="${MSG:-Update TypeRush}"
git add -A
git commit -m "$MSG" || true
git push origin "$(git branch --show-current)"
echo "Done. GitHub has been updated."
