data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# ─── Execution role ─────────────────────────────────────────────────────────
# Used by the ECS agent itself (not the app) to pull the image from ECR,
# write logs to CloudWatch, and fetch Secrets Manager values into env vars
# at container start. This is why secrets can be injected with zero
# application code changes — ECS resolves them before the app ever starts.
resource "aws_iam_role" "ecs_execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_execution_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.database_url.arn,
      aws_secretsmanager_secret.access_token_secret.arn,
      aws_secretsmanager_secret.refresh_token_secret.arn,
      aws_secretsmanager_secret.twilio_account_sid.arn,
      aws_secretsmanager_secret.twilio_auth_token.arn,
    ]
  }
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name   = "${local.name}-read-secrets"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution_secrets.json
}

# ─── Task role ──────────────────────────────────────────────────────────────
# Used by the application code itself at runtime. The @aws-sdk/client-s3
# calls in server/src/config/storage.js pick this up automatically via the
# default credential provider chain — no access keys anywhere in the app.
resource "aws_iam_role" "ecs_task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "ecs_task_s3_evidence" {
  statement {
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.evidence.arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.evidence.arn]
  }
}

resource "aws_iam_role_policy" "ecs_task_s3_evidence" {
  name   = "${local.name}-evidence-bucket-access"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task_s3_evidence.json
}
