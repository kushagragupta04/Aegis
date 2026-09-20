variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short name used as a prefix for every resource"
  type        = string
  default     = "aegis"
}

variable "enable_cloudfront" {
  description = "Temporary escape hatch: set to false if your AWS account is blocked from creating CloudFront resources pending AWS's account verification (a routine check on new accounts — see infra/README.md). When false, the ECS service and outputs fall back to the ALB's plain-HTTP DNS name so you can still deploy and test everything else. Flip back to true (the default) once your account clears and re-apply — no other changes needed."
  type        = bool
  default     = true
}

variable "container_port" {
  description = "Port the aegis-server container listens on (must match PORT env var)"
  type        = number
  default     = 3000
}

variable "container_image_tag" {
  description = "Tag of the aegis-server image in ECR to deploy (push it first with scripts/push-image.sh)"
  type        = string
  default     = "latest"
}

variable "fargate_cpu" {
  description = "Fargate task vCPU units (256 = .25 vCPU, 512 = .5 vCPU)"
  type        = number
  default     = 512
}

variable "fargate_memory" {
  description = "Fargate task memory in MB"
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Number of ECS tasks to run. Set to 2 to demonstrate the Socket.IO Redis adapter actually fanning broadcasts out across instances."
  type        = number
  default     = 1
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  description = "RDS allocated storage in GB"
  type        = number
  default     = 20
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "aegis"
}

variable "db_master_username" {
  description = "RDS master username"
  type        = string
  default     = "aegis_admin"
}

variable "elasticache_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.t3.micro"
}

variable "db_publicly_accessible" {
  description = "Temporary: RDS needs a public IP (in addition to a security-group rule via db_migration_cidr) for your laptop to reach it directly to run migrations. Set true briefly, run `npm run db:migrate`, then set back to false and re-apply."
  type        = bool
  default     = false
}

variable "db_migration_cidr" {
  description = "Optional: your own IP (as a /32 CIDR, e.g. 1.2.3.4/32) temporarily allowed to reach RDS directly to run `npm run db:migrate` from your laptop. Leave empty (default) to keep RDS reachable only from the ECS tasks' security group."
  type        = string
  default     = ""
}

variable "twilio_account_sid" {
  description = "Twilio Account SID (optional — leave blank and update the secret later if you don't have one yet; SMS alerts fall back to console logging until set)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "twilio_auth_token" {
  description = "Twilio Auth Token (optional, see twilio_account_sid)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "twilio_phone_number" {
  description = "Twilio phone number to send SMS alerts from (optional, see twilio_account_sid)"
  type        = string
  default     = ""
}
