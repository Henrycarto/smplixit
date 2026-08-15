/**
 * PostgreSQL for the audit trail and job history.
 *
 * This database holds PHI: the source discharge summary, the text handed to the
 * patient, and every rejected rewrite attempt in between. The configuration
 * below is driven by that, not by cost.
 *
 *   Encrypted at rest with a customer-managed key, so key access is revocable
 *   independently of database access.
 *
 *   Multi-AZ, because the audit trail is the record a hospital produces under
 *   audit and a single-AZ failure that loses recent writes is not recoverable
 *   by rerunning anything.
 *
 *   No public accessibility, in a subnet with no NAT route.
 *
 *   Deletion protection and a final snapshot in production. An accidental
 *   `terraform destroy` must not be able to delete a compliance record.
 */

resource "random_password" "db" {
  length  = 40
  special = true
  # RDS rejects these characters in a master password.
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_secretsmanager_secret" "db" {
  name       = "${local.name}/database"
  kms_key_id = aws_kms_key.main.id

  tags = { Name = "${local.name}-database" }
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id

  secret_string = jsonencode({
    username = aws_db_instance.main.username
    password = random_password.db.result
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = aws_db_instance.main.db_name
  })
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.database[*].id

  tags = { Name = local.name }
}

resource "aws_db_parameter_group" "main" {
  name   = local.name
  family = "postgres16"

  # Reject any unencrypted connection at the database, not only at the client.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Log statements slower than two seconds. Fast enough to catch a missing
  # index on the audit table, quiet enough not to log every write.
  parameter {
    name  = "log_min_duration_statement"
    value = "2000"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  tags = { Name = local.name }
}

resource "aws_db_instance" "main" {
  identifier = local.name

  engine         = "postgres"
  engine_version = "16.4"
  instance_class = var.db_instance_class

  db_name  = "smplixit"
  username = "smplixit"
  password = random_password.db.result

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 4
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.main.arn

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]
  parameter_group_name   = aws_db_parameter_group.main.name
  publicly_accessible    = false

  multi_az                = var.environment == "production"
  backup_retention_period = var.db_backup_retention_days
  backup_window           = "07:00-08:00"
  maintenance_window      = "sun:08:30-sun:09:30"
  copy_tags_to_snapshot   = true

  # Point-in-time recovery for the audit trail comes from automated backups
  # plus transaction logs, which RDS retains for the backup window above.
  deletion_protection       = var.environment == "production"
  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "${local.name}-final" : null

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.main.arn
  performance_insights_retention_period = 7

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_monitoring.arn

  auto_minor_version_upgrade = true
  apply_immediately          = var.environment != "production"

  tags = { Name = local.name }
}

resource "aws_iam_role" "rds_monitoring" {
  name = "${local.name}-rds-monitoring"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

locals {
  # sslmode=require is not optional. rds.force_ssl above rejects anything else,
  # so a missing parameter here surfaces as a connection failure at boot rather
  # than as a silent plaintext session.
  database_url = join("", [
    "postgresql+asyncpg://",
    aws_db_instance.main.username,
    ":${urlencode(random_password.db.result)}@",
    aws_db_instance.main.endpoint,
    "/${aws_db_instance.main.db_name}",
    "?ssl=require",
  ])
}

/* ------------------------------------------------------------------ alarms */

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${local.name}-db-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  tags = { Name = "${local.name}-db-cpu" }
}

resource "aws_cloudwatch_metric_alarm" "db_storage" {
  alarm_name          = "${local.name}-db-storage"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  # 10 GB free. Storage autoscaling handles growth, this catches the case
  # where autoscaling has hit its ceiling.
  threshold = 10737418240

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  tags = { Name = "${local.name}-db-storage" }
}

/* ----------------------------------------------------------------- outputs */

output "database_endpoint" {
  value     = aws_db_instance.main.endpoint
  sensitive = true
}

output "database_secret_arn" {
  value = aws_secretsmanager_secret.db.arn
}
