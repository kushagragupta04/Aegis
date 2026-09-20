resource "aws_ecs_cluster" "main" {
  name = local.name
  tags = local.tags

  setting {
    name  = "containerInsights"
    value = "disabled" # extra CloudWatch metrics cost — enable if you want deeper dashboards
  }
}

resource "aws_cloudwatch_log_group" "server" {
  name              = "/ecs/${local.name}-server"
  retention_in_days = 14
  tags              = local.tags
}

# ─── ALB ────────────────────────────────────────────────────────────────────
resource "aws_lb" "main" {
  name               = "${local.name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.default.ids
  tags               = local.tags
}

resource "aws_lb_target_group" "server" {
  name        = "${local.name}-tg"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip" # required for awsvpc network mode (Fargate)

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 10
  }

  tags = local.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.server.arn
  }
}

# ─── Task definition ─────────────────────────────────────────────────────────
# One container runs the whole aegis-server image: Express API, Socket.IO,
# and the BullMQ workers (alert/incident/evidence-cleanup) all start from the
# same src/server.js entrypoint, matching how docker-compose already runs it.
resource "aws_ecs_task_definition" "server" {
  family                   = "${local.name}-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.fargate_cpu
  memory                   = var.fargate_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "server"
      image     = "${aws_ecr_repository.server.repository_url}:${var.container_image_tag}"
      essential = true

      portMappings = [{
        containerPort = var.container_port
        protocol      = "tcp"
      }]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = tostring(var.container_port) },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "EVIDENCE_S3_BUCKET", value = aws_s3_bucket.evidence.bucket },
        { name = "REDIS_URL", value = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:${aws_elasticache_cluster.main.cache_nodes[0].port}" },
        { name = "FRONTEND_URL", value = local.app_url },
        # Also allow a local Vite dev server to call the deployed API/Socket.IO
        # directly — genuinely useful for testing against real infra without
        # a full frontend deploy, and harmless to leave on permanently.
        { name = "CORS_ORIGIN", value = "${local.app_url},http://localhost:5173" },
        { name = "TWILIO_PHONE_NUMBER", value = var.twilio_phone_number },
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = "ACCESS_TOKEN_SECRET", valueFrom = aws_secretsmanager_secret.access_token_secret.arn },
        { name = "REFRESH_TOKEN_SECRET", valueFrom = aws_secretsmanager_secret.refresh_token_secret.arn },
        { name = "TWILIO_ACCOUNT_SID", valueFrom = aws_secretsmanager_secret.twilio_account_sid.arn },
        { name = "TWILIO_AUTH_TOKEN", valueFrom = aws_secretsmanager_secret.twilio_auth_token.arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.server.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "server"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget -qO- http://localhost:${var.container_port}/health || exit 1"]
        interval    = 30
        timeout     = 10
        retries     = 3
        startPeriod = 40
      }
    }
  ])

  tags = local.tags
}

resource "aws_ecs_service" "server" {
  name            = "${local.name}-server"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.server.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true # no NAT Gateway in this default-VPC setup — needed for outbound ECR/Twilio/OSM calls
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.server.arn
    container_name   = "server"
    container_port   = var.container_port
  }

  depends_on = [aws_lb_listener.http]

  tags = local.tags
}
