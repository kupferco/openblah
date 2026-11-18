#!/usr/bin/env bash
# Check that the Cloud Scheduler job for the call-history cleanup exists (T19, docs/deploy.md).
# Usage: scripts/check-history-cleanup.sh <gcp-project-id> [region]
# Prints a ::viber-manual:: marker when the owner has to create it.
set -uo pipefail
project="${1:?gcp project id}"
region="${2:-europe-west1}"
job="openblah-history-cleanup"

manual() { echo "::viber-manual::$1"; exit 1; }

if ! command -v gcloud >/dev/null || ! gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q .; then
  manual "{\"reason\":\"gcloud is not logged in\",\"action\":\"Log in as the owner of project $project\",\"prerequisites\":[\"gcloud auth login\",\"gcloud config set project $project\"],\"commands\":[\"gcloud auth login\"],\"verify\":\"scripts/check-history-cleanup.sh $project prints 'cleanup job ok'\"}"
fi

if gcloud scheduler jobs describe "$job" --project="$project" --location="$region" >/dev/null 2>&1; then
  echo "cleanup job ok"; exit 0
fi

manual "{\"reason\":\"the Cloud Scheduler job $job does not exist, so saved call history is never deleted\",\"action\":\"As the project owner, create the cleanup secret and the daily job on this branch's docs/deploy.md section 'Call history cleanup (T19)'\",\"prerequisites\":[\"gcloud auth login\",\"gcloud config set project $project\"],\"commands\":[\"gcloud secrets create OPENBLAH_CLEANUP_SECRET --replication-policy=automatic\",\"openssl rand -hex 32 | tr -d '\\\\n' | gcloud secrets versions add OPENBLAH_CLEANUP_SECRET --data-file=-\",\"gcloud run services update openblah-server --region $region --update-secrets OPENBLAH_CLEANUP_SECRET=OPENBLAH_CLEANUP_SECRET:latest\",\"gcloud scheduler jobs create http $job --location=$region --schedule='17 3 * * *' --http-method=POST --uri=\\\"\$(gcloud run services describe openblah-server --region $region --format='value(status.url)')/internal/history/cleanup\\\" --headers=\\\"Authorization=Bearer \$(gcloud secrets versions access latest --secret=OPENBLAH_CLEANUP_SECRET)\\\"\"],\"verify\":\"scripts/check-history-cleanup.sh $project prints 'cleanup job ok'\"}"
