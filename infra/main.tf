terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # For a hackathon this defaults to local state (terraform.tfstate on disk).
  # If more than one person needs to run `terraform apply`, uncomment and
  # point this at an S3 bucket + DynamoDB lock table instead.
  # backend "s3" {
  #   bucket = "aegis-terraform-state"
  #   key    = "aegis/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Deliberately using the account's default VPC + its (public) default subnets
# rather than provisioning a custom VPC. A custom VPC with private subnets for
# RDS/ElastiCache would need a NAT Gateway (~$32/month fixed, plus data
# processing) purely so Fargate tasks in a private subnet can reach the
# internet (ECR pulls, Twilio, Nominatim/Overpass/OSRM, S3). For a 4-day
# hackathon budget that cost isn't justified. Instead, RDS and ElastiCache are
# placed in the default VPC's subnets but are NOT publicly accessible and are
# locked down by security group to only accept traffic from the ECS tasks'
# security group. Fargate tasks get a public IP (needed for outbound internet
# access with no NAT Gateway) but only accept inbound traffic from the ALB.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

locals {
  name = var.project_name
  tags = {
    Project   = var.project_name
    ManagedBy = "terraform"
  }

  # The one public URL for the whole app. Normally CloudFront's HTTPS domain;
  # falls back to the ALB's plain-HTTP DNS name when enable_cloudfront=false
  # (see variables.tf) so the app can still be deployed and tested while an
  # AWS account-verification block on CloudFront is pending.
  app_url = var.enable_cloudfront ? "https://${aws_cloudfront_distribution.main[0].domain_name}" : "http://${aws_lb.main.dns_name}"
}
