resource "random_password" "db_master" {
  length  = 24
  special = false # avoid characters that need URL-encoding inside DATABASE_URL
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = data.aws_subnets.default.ids
  tags       = local.tags
}

# RDS PostgreSQL supports the PostGIS extension out of the box — the master
# user can run `CREATE EXTENSION postgis;` directly (that's exactly what
# server/src/db/migrations/001_extensions.sql already does). No special RDS
# parameter group is needed for this.
resource "aws_db_instance" "main" {
  identifier     = "${local.name}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage_gb
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = var.db_name
  username = var.db_master_username
  password = random_password.db_master.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = var.db_publicly_accessible

  multi_az = false # single-AZ — the cost-conscious, hackathon-appropriate choice; flip to true for real production HA

  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false # convenience for a hackathon teardown; disable this before any real production use

  tags = local.tags
}
