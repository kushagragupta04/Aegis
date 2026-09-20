# ─── Evidence audio storage ─────────────────────────────────────────────────
# Fixes the #1 critical execution bug: local container disk is ephemeral and
# per-task, so evidence uploaded on one Fargate task is invisible to (or lost
# on restart of) any other task. The app talks to this bucket via the ECS
# task role's credentials (see iam.tf) — no static AWS keys anywhere.
resource "aws_s3_bucket" "evidence" {
  bucket = "${local.name}-evidence-${data.aws_caller_identity.current.account_id}"
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket                  = aws_s3_bucket.evidence.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Belt-and-suspenders alongside the app's own 30-day BullMQ cleanup worker —
# guarantees old evidence doesn't linger even if that cron job is ever
# skipped/broken.
resource "aws_s3_bucket_lifecycle_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  rule {
    id     = "expire-old-evidence"
    status = "Enabled"
    filter {}
    expiration {
      days = 60
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  cors_rule {
    allowed_methods = ["GET"]
    allowed_origins = ["*"] # presigned GET URLs are short-lived (120s) and scoped to one object
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

# ─── Frontend static build ──────────────────────────────────────────────────
# Private bucket — never public directly. CloudFront reaches it via Origin
# Access Control (see cloudfront.tf).
resource "aws_s3_bucket" "frontend" {
  bucket = "${local.name}-frontend-${data.aws_caller_identity.current.account_id}"
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "frontend" {
  count  = var.enable_cloudfront ? 1 : 0
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.main[0].arn
        }
      }
    }]
  })
}
