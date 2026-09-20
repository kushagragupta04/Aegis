# ─── ALB ────────────────────────────────────────────────────────────────────
# Public: accepts HTTP from the internet (CloudFront talks to the ALB over
# plain HTTP; CloudFront itself terminates HTTPS for browsers — see
# cloudfront.tf for why this avoids needing an ACM certificate/custom domain).
resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Allow inbound HTTP from CloudFront/internet"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP from anywhere (fronted by CloudFront)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

# ─── ECS tasks (API + Socket.IO + BullMQ workers, one process) ────────────────
# Only reachable from the ALB, never directly from the internet.
resource "aws_security_group" "ecs_tasks" {
  name        = "${local.name}-ecs-tasks"
  description = "Allow inbound only from the ALB"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "App port from ALB only"
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

# ─── RDS (PostgreSQL + PostGIS) ────────────────────────────────────────────────
# No public access. Only the ECS tasks' security group can reach it, plus
# optionally your own IP (via db_migration_cidr) to run migrations once.
resource "aws_security_group" "rds" {
  name        = "${local.name}-rds"
  description = "Allow Postgres only from ECS tasks (and optionally one dev IP for migrations)"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Postgres from ECS tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  dynamic "ingress" {
    for_each = var.db_migration_cidr != "" ? [var.db_migration_cidr] : []
    content {
      description = "Temporary: run db:migrate from a developer machine"
      from_port   = 5432
      to_port     = 5432
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

# ─── ElastiCache (Redis) ────────────────────────────────────────────────────────
resource "aws_security_group" "redis" {
  name        = "${local.name}-redis"
  description = "Allow Redis only from ECS tasks"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Redis from ECS tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}
