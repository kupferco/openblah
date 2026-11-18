#!/usr/bin/env bash
# Check that the GCP billing budget for OpenBlah exists: £50/month with alerts at 50%, 80% and 100%.
# Usage: scripts/check-gcp-budget.sh <gcp-project-id> [billing-account-id]
# Needs gcloud logged in with Billing Account Viewer (owner only). See docs/costs.md.
set -uo pipefail
project="${1:?gcp project id}"
account="${2:-${GCP_BILLING_ACCOUNT:-}}"

manual() { echo "::viber-manual::$1"; exit 1; }

if ! command -v gcloud >/dev/null || ! gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q .; then
  manual "{\"reason\":\"gcloud is not logged in\",\"action\":\"Log in with an account that can view billing budgets (Billing Account Viewer)\",\"prerequisites\":[\"gcloud auth login\",\"gcloud config set project $project\"],\"commands\":[\"gcloud auth login\"],\"verify\":\"scripts/check-gcp-budget.sh $project prints 'budget ok'\"}"
fi

if [ -z "$account" ]; then
  account=$(gcloud billing projects describe "$project" --format='value(billingAccountName)' 2>/dev/null | sed 's#billingAccounts/##')
fi
if [ -z "$account" ]; then
  manual "{\"reason\":\"could not find the billing account of project $project\",\"action\":\"Pass the billing account id as the second argument, or link billing to the project\",\"commands\":[\"gcloud billing accounts list\",\"scripts/check-gcp-budget.sh $project <ACCOUNT_ID>\"],\"verify\":\"the script prints 'budget ok'\"}"
fi

json=$(gcloud billing budgets list --billing-account="$account" --format=json 2>/dev/null) || \
  manual "{\"reason\":\"could not list budgets: the account lacks billing.budgets.list\",\"action\":\"Ask a billing admin to grant Billing Account Viewer, or run this as the owner\",\"commands\":[\"gcloud billing budgets list --billing-account=$account\"],\"verify\":\"the command lists budgets\"}"

# A budget is fine when it is £50 (GBP), covers this project (or the whole account) and has 50/80/100% thresholds.
ok=$(printf '%s' "$json" | python3 -I -c '
import json, sys
project = sys.argv[1]
for b in json.load(sys.stdin):
    amt = b.get("amount", {}).get("specifiedAmount", {})
    value = float(amt.get("units", 0)) + amt.get("nanos", 0) / 1e9
    projects = b.get("budgetFilter", {}).get("projects", [])
    scoped = not projects or any(p.endswith("/" + project) or p == "projects/" + project for p in projects)
    pcts = {round(float(t.get("thresholdPercent", 0)), 2) for t in b.get("thresholdRules", [])}
    if amt.get("currencyCode") == "GBP" and value == 50 and scoped and {0.5, 0.8, 1.0} <= pcts:
        print("yes"); break
' "$project")

if [ "$ok" = "yes" ]; then echo "budget ok"; exit 0; fi

manual "{\"reason\":\"no GBP 50/month budget with alerts at 50%, 80% and 100% exists for $project\",\"action\":\"In GCP Billing create a budget of 50 GBP per month on the project with alerts at 50%, 80% and 100% (25, 40, 50 GBP), notifying the owner's email\",\"prerequisites\":[\"gcloud auth login\"],\"commands\":[\"gcloud billing budgets create --billing-account=$account --display-name=openblah-monthly --budget-amount=50GBP --filter-projects=projects/$project --threshold-rule=percent=0.5 --threshold-rule=percent=0.8 --threshold-rule=percent=1.0\"],\"verify\":\"scripts/check-gcp-budget.sh $project prints 'budget ok'\"}"
