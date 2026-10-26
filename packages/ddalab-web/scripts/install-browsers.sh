#!/usr/bin/env bash
# Installs Playwright browsers with their system packages on a CI runner. Ubuntu's mirror has stalled mid-download
# until the job timed out, and a try stopped by the time limit left apt holding its lock for the next one. apt now
# gives up on a stalled connection after 30 s and retries it, each try gets 15 minutes, and a new try waits for the
# previous one's apt to let go of its locks.
# Usage: scripts/install-browsers.sh chromium firefox webkit
set -u
echo 'Acquire::Retries "5"; Acquire::http::Timeout "30"; Acquire::https::Timeout "30";' |
  sudo tee /etc/apt/apt.conf.d/80-ci-retries >/dev/null
for try in 1 2 3; do
  timeout 300 bash -c 'while sudo fuser /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock >/dev/null 2>&1; do sleep 5; done'
  timeout 900 npx playwright install --with-deps "$@" && exit 0
  echo "Browser install try $try failed or hung" >&2
done
exit 1
