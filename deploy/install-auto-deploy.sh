#!/bin/sh
# Install (or update) automatic deploys on the server, following one branch. Run as root, from the repository:
#   sudo /opt/lotuspond-accounts/deploy/install-auto-deploy.sh staging
# Run it again to change the branch, or after changing deploy/systemd/. To stop automatic deploys:
#   sudo systemctl disable --now lotuspond-accounts-auto-deploy.timer
set -eu
branch=${1:?Usage: install-auto-deploy.sh <branch>, for example staging}
case "$branch" in *[!A-Za-z0-9._/-]*) echo "Not a branch name: $branch" >&2; exit 1 ;; esac
here=$(cd "$(dirname "$0")" && pwd)
install -m 644 "$here/systemd/lotuspond-accounts-auto-deploy.service" /etc/systemd/system/
install -m 644 "$here/systemd/lotuspond-accounts-auto-deploy.timer" /etc/systemd/system/
install -d /etc/systemd/system/lotuspond-accounts-auto-deploy.service.d
printf '[Service]\nEnvironment=DEPLOY_BRANCH=%s\n' "$branch" > /etc/systemd/system/lotuspond-accounts-auto-deploy.service.d/branch.conf
systemctl daemon-reload
systemctl enable --now lotuspond-accounts-auto-deploy.timer
systemctl list-timers lotuspond-accounts-auto-deploy.timer --no-pager
echo "This server now deploys each new commit on $branch. Log: journalctl -u lotuspond-accounts-auto-deploy -f"
