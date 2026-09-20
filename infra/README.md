# Aegis — AWS infrastructure (Terraform)

This provisions the "Ship It" deployment for Aegis: ECS Fargate running the
existing `server/Dockerfile` image, RDS PostgreSQL+PostGIS, ElastiCache
Redis, S3 for evidence storage and the static frontend build, one CloudFront
distribution in front of both, Secrets Manager for credentials, and
CloudWatch logs.

**This has not been applied.** Nothing in AWS exists yet — review the plan,
then run it yourself with your own AWS credentials.

All example commands below assume the default `project_name = "aegis"` (e.g.
secret names like `aegis/database-url`) — adjust if you override it.

## Architecture in one paragraph

One CloudFront distribution serves everything over HTTPS on its default
`*.cloudfront.net` domain: `/*` goes to an S3 bucket (the built React app),
and `/api/*` + `/socket.io/*` go to an ALB in front of one ECS Fargate
service. That one Fargate task runs `server/src/server.js` unchanged — the
Express API, Socket.IO, and the BullMQ workers all start from the same
process, exactly like `docker-compose` already runs it locally, so there's
one ECS service, not two. RDS and ElastiCache sit in the default VPC's
subnets but are locked down by security group to only accept traffic from
the ECS tasks. See the comments in each `.tf` file for the reasoning behind
each specific choice (they're written to double as your "why AWS" notes).

## Why route API traffic through CloudFront instead of hitting the ALB directly

The frontend is served over HTTPS (CloudFront). If the browser called the API
on a plain-HTTP ALB, browsers block that outright as mixed content — and a
real ACM certificate for the ALB needs a custom domain, which is out of scope
for a demo. Routing `/api/*` and `/socket.io/*` through the same CloudFront
distribution as a second origin gets HTTPS everywhere via CloudFront's own
certificate, with zero custom domain or ACM setup. CloudFront proxies to the
ALB over plain HTTP internally, including WebSocket upgrades.

## Prerequisites

- Terraform >= 1.5
- AWS CLI v2, authenticated (`aws sts get-caller-identity` should work)
- Docker (for building the server image)
- An AWS account with the usual EC2/RDS/ElastiCache/ECS/S3/CloudFront/IAM
  permissions (an admin or power-user role is simplest for a hackathon)

## Cost estimate (a few days, torn down after)

| Resource | Approx. cost |
|---|---|
| ECS Fargate (1 task, 0.5 vCPU/1GB) | ~$0.02/hr → a few dollars for the hackathon window |
| ALB | ~$0.0225/hr fixed + minimal LCU — the single biggest fixed line item |
| RDS db.t4g.micro | Often free-tier eligible; otherwise a few dollars |
| ElastiCache cache.t3.micro | ~$0.017/hr |
| S3 + CloudFront | Pennies at this scale |
| Secrets Manager | ~$0.40/secret/month, prorated to cents |

Comfortably inside a $200 hackathon credit if torn down within a few days
(see **Teardown** below — don't leave the ALB and RDS running indefinitely).

## Deploy order

There's a real chicken-and-egg between the ECS service and the image: the
service can't be created against an image that doesn't exist in ECR yet, but
the ECR repo doesn't exist until Terraform creates it. This is normal and
expected — `terraform apply` will succeed even though the ECS task briefly
fails to pull an image; you push the image right after.

```bash
cd infra
terraform init
terraform plan       # review everything before applying anything
terraform apply      # creates ECR, RDS, ElastiCache, S3, ALB, CloudFront,
                      # Secrets Manager, IAM, and the ECS service (which
                      # will fail to start tasks until the next step)

# Build and push the server image now that the ECR repo exists
./scripts/push-image.sh

# ECS will retry on its own within a minute or two, or force it immediately:
aws ecs update-service --cluster $(terraform output -raw ecs_cluster_name) \
  --service $(terraform output -raw ecs_cluster_name)-server \
  --force-new-deployment --region us-east-1
```

### Run database migrations

RDS is not publicly reachable by default. Either:

- **Temporarily** set `db_migration_cidr = "YOUR_IP/32"` in a `terraform.tfvars`
  file and `terraform apply` again, then from `server/`:
  ```bash
  export DATABASE_URL=$(aws secretsmanager get-secret-value \
    --secret-id aegis/database-url --query SecretString --output text)
  npm run db:migrate
  ```
- Or run a one-off ECS Fargate task using the same image/task role, with
  `command` overridden to `["node", "src/db/migrate.js"]`, inside the same
  VPC/subnets/security group — no public exposure needed at all. This is the
  cleaner option if you don't want to touch the RDS security group.

Remove the `db_migration_cidr` override afterwards and re-apply if you used
the first approach.

### Deploy the frontend

```bash
cd client
VITE_API_URL="$(terraform -chdir=../infra output -raw app_url)" \
VITE_SOCKET_URL="$(terraform -chdir=../infra output -raw app_url)" \
npm run build

aws s3 sync dist/ "s3://$(terraform -chdir=../infra output -raw frontend_bucket)" --delete

aws cloudfront create-invalidation \
  --distribution-id "$(terraform -chdir=../infra output -raw cloudfront_distribution_id)" \
  --paths "/*"
```

### Set real Twilio credentials (optional but recommended for the demo)

If you didn't pass `-var twilio_account_sid=... -var twilio_auth_token=...`
at apply time, update the secrets directly so the demo SMS is real instead of
a `[SMS MOCK]` console log line:

```bash
aws secretsmanager put-secret-value --secret-id aegis/twilio-account-sid --secret-string "<sid>"
aws secretsmanager put-secret-value --secret-id aegis/twilio-auth-token --secret-string "<token>"
aws ecs update-service --cluster $(terraform output -raw ecs_cluster_name) \
  --service $(terraform output -raw ecs_cluster_name)-server --force-new-deployment
```

### Verify it's actually working

```bash
curl "$(terraform output -raw app_url)/health"
aws logs tail "$(terraform output -raw cloudwatch_log_group)" --follow
```

Open `terraform output -raw app_url` in a browser — that one URL serves the
whole app.

### Demonstrate multi-instance Socket.IO scaling (optional, strong "Learning" talking point)

```bash
terraform apply -var desired_count=2
```

With the Redis adapter already wired in (`server/src/sockets/index.js`), a
guardian connected to one task still receives location updates whose insert
landed on the other task — this is the thing that silently breaks without
the adapter.

## Teardown

```bash
terraform destroy
```

RDS has `skip_final_snapshot = true` and `deletion_protection = false` —
deliberate hackathon conveniences so teardown is a single command. Don't
carry these settings into anything resembling real production use.

## What's deliberately NOT here

- **No custom VPC / private subnets / NAT Gateway** — the default VPC plus
  security-group isolation is the credible, cost-appropriate choice for a
  4-day build (see the comment in `main.tf`).
- **No Route 53 / custom domain / ACM certificate** — CloudFront's default
  domain already gets you HTTPS everywhere; a custom domain is a nice-to-have,
  not a requirement.
- **No Cognito** — the app's existing JWT + refresh-token-rotation auth
  already works and is arguably more sophisticated than a default Cognito
  setup; migrating it would be a lateral move, not an improvement, within a
  hackathon window.
- **No SQS/SNS** — BullMQ over the same ElastiCache Redis already does the
  job queue work (retries, backoff, per-job logging); swapping to SQS would
  mean rewriting three working workers for no functional gain.
