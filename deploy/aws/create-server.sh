#!/bin/bash
# Create a LotusPond Accounts server on Amazon Lightsail in Mumbai as a CloudFormation stack (lightsail.cfn.yaml), from
# AWS CloudShell or any shell with the AWS CLI. Prints the addresses to put in DNS. See docs/staging.md.
#   ENVIRONMENT=staging DOMAIN=staging.accounts.lotuspond.ai ACME_EMAIL=ops@lotuspond.ai SSH_CIDR=a.b.c.d/32 \
#     REF=main bash deploy/aws/create-server.sh
set -euo pipefail
ENVIRONMENT=${ENVIRONMENT:?Set ENVIRONMENT to staging or production}
DOMAIN=${DOMAIN:?Set DOMAIN, e.g. staging.accounts.lotuspond.ai}
ACME_EMAIL=${ACME_EMAIL:?Set ACME_EMAIL (Let\'s Encrypt sends certificate notices there)}
SSH_CIDR=${SSH_CIDR:?Set SSH_CIDR to the only address allowed to SSH, e.g. a.b.c.d/32}
REF=${REF:-main}
REGION=ap-south-1
STACK="lotuspond-accounts-$ENVIRONMENT-in"
case "$ENVIRONMENT" in
  staging) BUNDLE=small_3_1; MAIL_FROM='LotusPond Accounts (staging) <accounts@lotuspond.ai>' ;;
  production) BUNDLE=medium_3_1; MAIL_FROM='LotusPond Accounts <accounts@lotuspond.ai>' ;;
  *) echo "ENVIRONMENT must be staging or production." >&2; exit 1 ;;
esac
HERE=$(cd "$(dirname "$0")" && pwd)
export AWS_DEFAULT_REGION=$REGION

if aws cloudformation describe-stacks --stack-name "$STACK" >/dev/null 2>&1; then
  echo "Stack $STACK already exists; showing its outputs."
else
  WORK=$(mktemp -d)
  trap 'rm -rf "$WORK"' EXIT
  python3 - "$HERE/first-boot.sh" "$WORK/params.json" <<PY
import json, sys
script, out = sys.argv[1:]
body = open(script).read()
for k, v in {"__REF__": "$REF", "__DOMAIN__": "$DOMAIN", "__ACME_EMAIL__": "$ACME_EMAIL",
             "__MAIL_FROM__": "$MAIL_FROM", "__CONFIGURATION_SET__": "lotuspond-accounts-$ENVIRONMENT"}.items():
    body = body.replace(k, v)
json.dump([
  {"ParameterKey": "Environment", "ParameterValue": "$ENVIRONMENT"},
  {"ParameterKey": "BundleId", "ParameterValue": "$BUNDLE"},
  {"ParameterKey": "SshCidr", "ParameterValue": "$SSH_CIDR"},
  {"ParameterKey": "UserData", "ParameterValue": body},
], open(out, "w"))
PY
  aws cloudformation create-stack --stack-name "$STACK" --template-body "file://$HERE/lightsail.cfn.yaml" \
    --parameters "file://$WORK/params.json" --tags Key=project,Value=lotuspond-accounts Key=environment,Value="$ENVIRONMENT" >/dev/null
  echo "Creating stack $STACK…"
  aws cloudformation wait stack-create-complete --stack-name "$STACK"
fi
aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Outputs' --output table
echo "Point $DOMAIN at the static IP (A) and the IPv6 address (AAAA). Caddy gets the certificate once DNS resolves."
