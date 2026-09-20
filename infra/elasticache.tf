resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name}-redis"
  subnet_ids = data.aws_subnets.default.ids
}

# A single cache.t3.micro node — no cluster mode, no replicas. This backs
# BullMQ job queues, map/geocode caching, voice-SOS cooldown keys, and the
# Socket.IO Redis adapter. A single node is a real availability tradeoff
# (no automatic failover) but is the right cost/complexity call for a
# hackathon deployment; a production upgrade path is a replication group
# with automatic failover enabled.
resource "aws_elasticache_cluster" "main" {
  cluster_id           = "${local.name}-redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.elasticache_node_type
  num_cache_nodes      = 1
  port                 = 6379
  parameter_group_name = "default.redis7"

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  tags = local.tags
}
