#!/bin/sh
# Point git at the versioned hooks. Run once after cloning.
set -e
git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true
echo "git hooks enabled (core.hooksPath=.githooks)"
