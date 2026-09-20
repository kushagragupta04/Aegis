output "app_url" {
  description = "The single public URL for the whole app (frontend + API + Socket.IO). HTTPS via CloudFront normally; plain HTTP via the ALB when enable_cloudfront=false."
  value       = local.app_url
}

output "alb_dns_name" {
  description = "Raw ALB DNS name (HTTP only, not for browser use — CloudFront fronts this)"
  value       = aws_lb.main.dns_name
}

output "ecr_repository_url" {
  description = "Push the aegis-server image here before the ECS service can start"
  value       = aws_ecr_repository.server.repository_url
}

output "frontend_bucket" {
  description = "S3 bucket to `aws s3 sync client/dist s3://<this>` after building the frontend"
  value       = aws_s3_bucket.frontend.bucket
}

output "evidence_bucket" {
  description = "S3 bucket the app stores evidence audio chunks in"
  value       = aws_s3_bucket.evidence.bucket
}

output "cloudfront_distribution_id" {
  description = "Needed to invalidate the CloudFront cache after a frontend redeploy. Empty while enable_cloudfront=false."
  value       = var.enable_cloudfront ? aws_cloudfront_distribution.main[0].id : ""
}

output "rds_endpoint" {
  description = "RDS address (not publicly reachable — for reference / running db:migrate via db_migration_cidr)"
  value       = aws_db_instance.main.address
}

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint (not publicly reachable)"
  value       = "${aws_elasticache_cluster.main.cache_nodes[0].address}:${aws_elasticache_cluster.main.cache_nodes[0].port}"
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "cloudwatch_log_group" {
  description = "Tail with: aws logs tail <this> --follow"
  value       = aws_cloudwatch_log_group.server.name
}
