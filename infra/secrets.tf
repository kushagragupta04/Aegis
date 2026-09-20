resource "random_password" "access_token_secret" {
  length  = 48
  special = false
}

resource "random_password" "refresh_token_secret" {
  length  = 48
  special = false
}

# One secret per credential (rather than one big JSON blob) so each maps
# cleanly to a single ECS "secrets" entry / env var in ecs.tf, and so
# rotating one credential later doesn't require reshaping a JSON document.

resource "aws_secretsmanager_secret" "database_url" {
  name = "${local.name}/database-url"
  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql://${var.db_master_username}:${random_password.db_master.result}@${aws_db_instance.main.address}:5432/${var.db_name}"
}

resource "aws_secretsmanager_secret" "access_token_secret" {
  name = "${local.name}/access-token-secret"
  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "access_token_secret" {
  secret_id     = aws_secretsmanager_secret.access_token_secret.id
  secret_string = random_password.access_token_secret.result
}

resource "aws_secretsmanager_secret" "refresh_token_secret" {
  name = "${local.name}/refresh-token-secret"
  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "refresh_token_secret" {
  secret_id     = aws_secretsmanager_secret.refresh_token_secret.id
  secret_string = random_password.refresh_token_secret.result
}

# Twilio is optional — if left blank, the app's own fallback logs
# "[SMS MOCK] ..." instead of sending. Update these after `terraform apply`
# with: aws secretsmanager put-secret-value --secret-id <name> --secret-string <value>
resource "aws_secretsmanager_secret" "twilio_account_sid" {
  name = "${local.name}/twilio-account-sid"
  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "twilio_account_sid" {
  secret_id     = aws_secretsmanager_secret.twilio_account_sid.id
  secret_string = var.twilio_account_sid != "" ? var.twilio_account_sid : "unset"
}

resource "aws_secretsmanager_secret" "twilio_auth_token" {
  name = "${local.name}/twilio-auth-token"
  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "twilio_auth_token" {
  secret_id     = aws_secretsmanager_secret.twilio_auth_token.id
  secret_string = var.twilio_auth_token != "" ? var.twilio_auth_token : "unset"
}
