# One distribution, two origins:
#   - default behavior (/*)              -> S3 frontend bucket (static SPA build)
#   - /api/*  and /socket.io/*  behaviors -> ALB (Express API + Socket.IO)
#
# This gives the whole app a single HTTPS domain on CloudFront's own default
# certificate — no custom domain or ACM certificate needed for the hackathon
# demo — while avoiding browser mixed-content blocking (an HTTPS page cannot
# call an HTTP API/WebSocket). CloudFront terminates TLS for the browser and
# talks to the ALB over plain HTTP internally, including WebSocket upgrades.

resource "aws_cloudfront_origin_access_control" "frontend" {
  count                             = var.enable_cloudfront ? 1 : 0
  name                              = "${local.name}-frontend-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# AWS managed policies — stable IDs, documented at
# https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html
locals {
  cf_cache_policy_caching_optimized   = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  cf_cache_policy_caching_disabled    = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  cf_origin_request_policy_all_viewer = "216adef6-5c7f-47e4-b989-5492eafa07d3"
}

resource "aws_cloudfront_distribution" "main" {
  count = var.enable_cloudfront ? 1 : 0

  enabled             = true
  default_root_object = "index.html"
  comment             = "${local.name} — frontend + API/WebSocket"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "frontend-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend[0].id
  }

  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "api-alb"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only" # ALB has no HTTPS listener — see the top-of-file comment
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "frontend-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = local.cf_cache_policy_caching_optimized
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "api-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = local.cf_cache_policy_caching_disabled
    origin_request_policy_id = local.cf_origin_request_policy_all_viewer
  }

  ordered_cache_behavior {
    path_pattern             = "/socket.io/*"
    target_origin_id         = "api-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = local.cf_cache_policy_caching_disabled
    origin_request_policy_id = local.cf_origin_request_policy_all_viewer
  }

  # SPA client-side routing: any path S3 doesn't have (e.g. /guardian/alert/xyz
  # on a hard refresh) should serve index.html and let React Router take over,
  # instead of surfacing S3's raw 403/404.
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = local.tags
}
