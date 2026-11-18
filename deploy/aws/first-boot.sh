#!/bin/bash
# First-boot script for a LotusPond Accounts Lightsail server (Ubuntu 24.04), rendered by create-server.sh, which fills
# in the placeholders below. The repository is public, so no key is needed to clone it; this script holds no secret.
# It installs Docker, clones the repository at the given ref, creates deploy/.env with fresh secrets, and starts the
# stack, and turns on automatic deploys of one branch if given one. SES keys are added to deploy/.env by hand afterwards
# (docs/staging.md). Log: /var/log/lotuspond-firstboot.log
set -eu
exec >>/var/log/lotuspond-firstboot.log 2>&1
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 git openssl unattended-upgrades
systemctl enable --now docker
usermod -aG docker ubuntu
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
REPO=/opt/lotuspond-accounts
install -d -o ubuntu -g ubuntu $REPO
sudo -u ubuntu git clone --branch '__REF__' https://github.com/lotuspond-ai/lotuspond-accounts.git $REPO
cd $REPO/deploy
if [ ! -f .env ]; then
  sudo -u ubuntu ./make-secrets.sh
  sed -i -e 's|^DOMAIN=.*|DOMAIN=__DOMAIN__|' -e 's|^ACME_EMAIL=.*|ACME_EMAIL=__ACME_EMAIL__|' .env
  echo 'MAIL_FROM=__MAIL_FROM__' >> .env
  echo 'SES_CONFIGURATION_SET=__CONFIGURATION_SET__' >> .env
fi
docker compose up -d --build
echo "$(date -u +%FT%TZ) LotusPond Accounts stack started for __DOMAIN__"
# Automatic deploys of one branch (deploy/auto-deploy.sh), when create-server.sh was given one: staging follows staging.
if [ -n '__DEPLOY_BRANCH__' ]; then
  sudo -u ubuntu sh -c "git -C $REPO rev-parse HEAD > ~/.lotuspond-accounts-deployed"
  $REPO/deploy/install-auto-deploy.sh '__DEPLOY_BRANCH__'
fi
