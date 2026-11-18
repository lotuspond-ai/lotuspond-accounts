#!/bin/bash
# Pull-based deploys: the server follows one branch of this repository and deploys each new commit by itself, with no
# GitHub Actions and no inbound SSH (the servers allow SSH only from the Lightsail console). A systemd timer runs this
# every two minutes as ubuntu (deploy/systemd/, installed by install-auto-deploy.sh with the branch to follow: staging
# on the staging server). The repository is public, so fetching needs no key.
# It compares the branch with the last commit it deployed successfully (~/.lotuspond-accounts-deployed), not with the
# checkout. A commit that fails to deploy is not retried on every tick: the next new commit on the branch is tried.
# Deploy now: DEPLOY_BRANCH=staging deploy/auto-deploy.sh. Log: journalctl -u lotuspond-accounts-auto-deploy. See
# docs/staging.md, "Deploys".
#
# Everything runs inside main(), which bash reads in full before running: the deploy rewrites this file.
main() {
  set -euo pipefail
  local repo=${LOTUSPOND_REPO:-/opt/lotuspond-accounts}
  local branch=${DEPLOY_BRANCH:?Set DEPLOY_BRANCH to the branch this server follows, e.g. staging}
  local deployed_file="$HOME/.lotuspond-accounts-deployed"
  local failed_file="$HOME/.lotuspond-accounts-deploy-failed"
  local target current

  cd "$repo"
  git fetch --quiet origin "$branch"
  target=$(git rev-parse FETCH_HEAD)
  current=$(cat "$deployed_file" 2>/dev/null || echo none)
  [ "$target" = "$current" ] && exit 0
  if [ -f "$failed_file" ] && [ "$(cat "$failed_file")" = "$target" ]; then
    echo "auto-deploy: $target failed before; waiting for a newer commit on $branch."
    exit 0
  fi

  echo "auto-deploy: $branch is at $target, last deployed $current."
  # deploy/.env and deploy/backups are not tracked, so a checkout leaves them alone. A changed tracked file stops it.
  if git checkout --quiet --detach "$target" &&
     (cd deploy && docker compose up -d --build --remove-orphans --wait --wait-timeout 300); then
    echo "$target" > "$deployed_file"
    rm -f "$failed_file"
    echo "auto-deploy: $target is live."
  else
    echo "$target" > "$failed_file"
    echo "auto-deploy: deploying $target failed; the stack keeps what docker compose left running." >&2
    exit 1
  fi
}
main "$@"
