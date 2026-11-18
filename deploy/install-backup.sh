#!/bin/sh
# Install (or update) the nightly backup timer on the server, and age for the encrypted copies. Run once, as root:
#   sudo /opt/lotuspond-accounts/deploy/install-backup.sh
# To back up now: sudo systemctl start lotuspond-accounts-backup. Log: journalctl -u lotuspond-accounts-backup
set -eu
here=$(cd "$(dirname "$0")" && pwd)
command -v age >/dev/null || { apt-get update -q && apt-get install -y -q age; }
install -m 644 "$here/systemd/lotuspond-accounts-backup.service" /etc/systemd/system/
install -m 644 "$here/systemd/lotuspond-accounts-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lotuspond-accounts-backup.timer
systemctl list-timers lotuspond-accounts-backup.timer --no-pager
