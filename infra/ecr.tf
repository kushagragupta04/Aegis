# Single repo — the API server and the BullMQ workers run in the same image
# (server.js starts both), so there's only one Fargate service, not two.
# This is a deliberate simplification: the codebase already runs this way in
# docker-compose, and splitting into two services would need a new
# worker-only entrypoint for no functional benefit within a hackathon window.
resource "aws_ecr_repository" "server" {
  name                 = "${local.name}-server"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.tags
}

resource "aws_ecr_lifecycle_policy" "server" {
  repository = aws_ecr_repository.server.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep only the last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
