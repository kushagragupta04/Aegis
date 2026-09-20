#!/usr/bin/env bash
# Builds server/Dockerfile and pushes it to the ECR repo created by Terraform.
# Run this AFTER `terraform apply` (so the ECR repo exists) and BEFORE the
# ECS service can start successfully (it has nothing to pull otherwise).
#
# Usage: ./scripts/push-image.sh [tag]   (defaults to "latest")
set -euo pipefail

cd "$(dirname "$0")/.."   # infra/
TAG="${1:-latest}"

REPO_URL=$(terraform output -raw ecr_repository_url)
REGION=$(terraform output -raw ecr_repository_url | cut -d. -f4)
ACCOUNT_ID=$(echo "$REPO_URL" | cut -d. -f1)

echo "Repo:    $REPO_URL"
echo "Region:  $REGION"
echo "Tag:     $TAG"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

docker build --platform linux/amd64 -t "${REPO_URL}:${TAG}" ../server
docker push "${REPO_URL}:${TAG}"

CLUSTER=$(terraform output -raw ecs_cluster_name)

echo ""
echo "Pushed ${REPO_URL}:${TAG}"
echo "If the ECS service is already running, force a fresh deploy with:"
echo "  aws ecs update-service --cluster ${CLUSTER} --service ${CLUSTER}-server --force-new-deployment --region ${REGION}"
