/**
 * Smplixit network and shared infrastructure.
 *
 * Topology, and the reasoning behind it:
 *
 *   Public subnets    hold the ALB and the NAT gateways. Nothing else.
 *   Private subnets   hold every ECS task. No task has a public IP, so the only
 *                     inbound path to the application is through the ALB.
 *   Database subnets  hold RDS, with no route to a NAT gateway at all. The
 *                     database cannot reach the internet in either direction.
 *
 * The separate database subnet tier is the part that matters for a HIPAA
 * review. A private subnet with a NAT route can still exfiltrate outbound. A
 * subnet with no NAT route cannot, regardless of what runs in it.
 */

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Configured per environment with `terraform init -backend-config=...`.
  # State holds database endpoints and secret ARNs and is never local.
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(var.tags, {
      Environment = var.environment
    })
  }
}

locals {
  name = "${var.project}-${var.environment}"

  services = keys(var.service_config)

  # One public, one private, one database subnet per AZ.
  az_count = length(var.availability_zones)
}

data "aws_caller_identity" "current" {}

/* ------------------------------------------------------------------ VPC */

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = local.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = local.name }
}

resource "aws_subnet" "public" {
  count = local.az_count

  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "${local.name}-public-${count.index}", Tier = "public" }
}

resource "aws_subnet" "private" {
  count = local.az_count

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = var.availability_zones[count.index]

  tags = { Name = "${local.name}-private-${count.index}", Tier = "private" }
}

resource "aws_subnet" "database" {
  count = local.az_count

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 20)
  availability_zone = var.availability_zones[count.index]

  tags = { Name = "${local.name}-database-${count.index}", Tier = "database" }
}

/* --------------------------------------------------------------- routing */

resource "aws_eip" "nat" {
  count  = local.az_count
  domain = "vpc"

  tags = { Name = "${local.name}-nat-${count.index}" }
}

# One NAT gateway per AZ. A single shared gateway is cheaper, and it also means
# one AZ failure takes outbound connectivity from every task in the VPC.
resource "aws_nat_gateway" "main" {
  count = local.az_count

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  depends_on    = [aws_internet_gateway.main]

  tags = { Name = "${local.name}-nat-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  count = local.az_count

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count = local.az_count

  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[count.index].id
  }

  tags = { Name = "${local.name}-private-${count.index}" }
}

resource "aws_route_table_association" "private" {
  count = local.az_count

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# Deliberately has no default route. The database tier is isolated.
resource "aws_route_table" "database" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${local.name}-database" }
}

resource "aws_route_table_association" "database" {
  count = local.az_count

  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.database.id
}

/* --------------------------------------------------------- security groups */

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public entry point"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "To tasks in the private subnets"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = { Name = "${local.name}-alb" }
}

resource "aws_security_group" "tasks" {
  name        = "${local.name}-tasks"
  description = "ECS tasks"
  vpc_id      = aws_vpc.main.id

  # Ingress is added per service below, scoped to that service's port.

  egress {
    description = "Outbound to the model provider, DeepL, and openFDA over TLS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Service to service inside the VPC"
    from_port   = 8001
    to_port     = 8003
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = { Name = "${local.name}-tasks" }
}

resource "aws_security_group_rule" "tasks_from_alb" {
  for_each = var.service_config

  type                     = "ingress"
  description              = "ALB to ${each.key}"
  from_port                = each.value.port
  to_port                  = each.value.port
  protocol                 = "tcp"
  security_group_id        = aws_security_group.tasks.id
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "tasks_internal" {
  for_each = var.service_config

  type                     = "ingress"
  description              = "Service to service on ${each.key}"
  from_port                = each.value.port
  to_port                  = each.value.port
  protocol                 = "tcp"
  security_group_id        = aws_security_group.tasks.id
  source_security_group_id = aws_security_group.tasks.id
}

resource "aws_security_group" "database" {
  name        = "${local.name}-database"
  description = "RDS PostgreSQL"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from tasks only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.tasks.id]
  }

  # No egress rule. The database initiates nothing.

  tags = { Name = "${local.name}-database" }
}

/* ------------------------------------------------------------------- KMS */

resource "aws_kms_key" "main" {
  description             = "${local.name} encryption at rest for PHI"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  tags = { Name = local.name }
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.main.key_id
}

/* -------------------------------------------------------------------- S3 */

# Generated instruction PDFs. Objects here are patient-identifiable.
resource "aws_s3_bucket" "exports" {
  bucket = "${local.name}-instruction-exports"

  tags = { Name = "${local.name}-exports" }
}

resource "aws_s3_bucket_public_access_block" "exports" {
  bucket = aws_s3_bucket.exports.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "exports" {
  bucket = aws_s3_bucket.exports.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id

  # A generated PDF is a convenience copy. The authoritative record is the
  # audit row in Postgres, so the object itself does not need to live long.
  rule {
    id     = "expire-exports"
    status = "Enabled"

    filter {}

    expiration {
      days = 90
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

resource "aws_s3_bucket_policy" "exports_tls_only" {
  bucket = aws_s3_bucket.exports.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.exports.arn,
        "${aws_s3_bucket.exports.arn}/*",
      ]
      Condition = {
        Bool = { "aws:SecureTransport" = "false" }
      }
    }]
  })
}

/* --------------------------------------------------------------- outputs */

output "vpc_id" {
  value = aws_vpc.main.id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "exports_bucket" {
  value = aws_s3_bucket.exports.bucket
}

output "kms_key_arn" {
  value = aws_kms_key.main.arn
}

output "account_id" {
  value = data.aws_caller_identity.current.account_id
}
