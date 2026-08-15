/**
 * ECS Fargate cluster, one service per microservice.
 *
 * All three services run behind one internal ALB, routed by path prefix. A
 * single load balancer rather than three keeps the certificate and the WAF
 * association in one place, which is one boundary for a security review instead
 * of three.
 *
 * The listener is internal. The console reaches the API through it from inside
 * the VPC. Nothing in this file exposes a service to the public internet.
 */

/* --------------------------------------------------------------- registry */

resource "aws_ecr_repository" "service" {
  for_each = var.service_config

  name                 = "${var.project}-${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.main.arn
  }

  tags = { Name = "${var.project}-${each.key}" }
}

resource "aws_ecr_lifecycle_policy" "service" {
  for_each = aws_ecr_repository.service

  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 30 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
}

/* ---------------------------------------------------------------- cluster */

resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  configuration {
    execute_command_configuration {
      kms_key_id = aws_kms_key.main.arn
      logging    = "OVERRIDE"

      log_configuration {
        cloud_watch_encryption_enabled = true
        cloud_watch_log_group_name     = aws_cloudwatch_log_group.exec.name
      }
    }
  }

  tags = { Name = local.name }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  # No Spot on the default strategy. A task interrupted mid-rewrite is a
  # clinician watching a request fail, and the saving is not worth it.
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

/* ------------------------------------------------------------------- logs */

resource "aws_cloudwatch_log_group" "service" {
  for_each = var.service_config

  name              = "/ecs/${local.name}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.main.arn

  tags = { Name = "${local.name}-${each.key}" }
}

resource "aws_cloudwatch_log_group" "exec" {
  name              = "/ecs/${local.name}/exec"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.main.arn
}

/* ------------------------------------------------------------------- IAM */

data "aws_iam_policy_document" "task_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.task_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# The execution role pulls secrets at task start. The task role, below, is what
# the running application gets, and it deliberately cannot read them.
resource "aws_iam_role_policy" "execution_secrets" {
  name = "${local.name}-execution-secrets"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.app.arn, aws_secretsmanager_secret.db.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [aws_kms_key.main.arn]
      },
    ]
  })
}

resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.task_assume.json
}

resource "aws_iam_role_policy" "task" {
  name = "${local.name}-task"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = ["${aws_s3_bucket.exports.arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = [aws_kms_key.main.arn]
      },
    ]
  })
}

/* --------------------------------------------------------------- secrets */

resource "aws_secretsmanager_secret" "app" {
  name       = "${local.name}/app"
  kms_key_id = aws_kms_key.main.id

  tags = { Name = "${local.name}-app" }
}

/* ------------------------------------------------------- task definitions */

locals {
  # Every service gets the same base environment. Service-specific values come
  # from the secret, so adding a key does not require a Terraform change.
  common_environment = [
    { name = "ENVIRONMENT", value = var.environment },
    { name = "LOG_LEVEL", value = "INFO" },
    { name = "GUARD_SERVICE_URL", value = "http://${aws_lb.internal.dns_name}/guard" },
    { name = "POLY_SERVICE_URL", value = "http://${aws_lb.internal.dns_name}/poly" },
    { name = "S3_EXPORT_BUCKET", value = aws_s3_bucket.exports.bucket },
    { name = "AWS_REGION", value = var.aws_region },
  ]

  secret_keys = {
    core  = ["OPENAI_API_KEY"]
    poly  = ["DEEPL_API_KEY"]
    guard = ["OPENFDA_API_KEY"]
  }
}

resource "aws_ecs_task_definition" "service" {
  for_each = var.service_config

  family                   = "${local.name}-${each.key}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = each.key
    image     = "${aws_ecr_repository.service[each.key].repository_url}:${var.image_tag}"
    essential = true

    portMappings = [{
      containerPort = each.value.port
      protocol      = "tcp"
    }]

    environment = concat(
      local.common_environment,
      each.key == "core" ? [{ name = "DATABASE_URL", value = local.database_url }] : [],
    )

    secrets = [
      for key in local.secret_keys[each.key] : {
        name      = key
        valueFrom = "${aws_secretsmanager_secret.app.arn}:${key}::"
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.service[each.key].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = each.key
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl --fail --silent http://localhost:${each.value.port}/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }

    # PHI never lands on a container filesystem. A read-only root also removes
    # the easiest post-compromise foothold.
    readonlyRootFilesystem = true
    user                   = "10001"

    linuxParameters = {
      initProcessEnabled = true
    }
  }])

  tags = { Name = "${local.name}-${each.key}" }
}

/* -------------------------------------------------------- load balancing */

resource "aws_lb" "internal" {
  name               = substr("${local.name}-int", 0, 32)
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.private[*].id

  drop_invalid_header_fields = true
  enable_deletion_protection = var.environment == "production"

  tags = { Name = "${local.name}-internal" }
}

resource "aws_lb_target_group" "service" {
  for_each = var.service_config

  name        = substr("${local.name}-${each.key}", 0, 32)
  port        = each.value.port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  # Give an in-flight rewrite time to finish before the task goes away.
  deregistration_delay = 60

  tags = { Name = "${local.name}-${each.key}" }
}

resource "aws_lb_listener" "internal" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "application/json"
      message_body = jsonencode({ error = "unknown_route" })
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "service" {
  for_each = var.service_config

  listener_arn = aws_lb_listener.internal.arn
  priority     = index(local.services, each.key) + 1

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service[each.key].arn
  }

  condition {
    path_pattern {
      values = ["/${each.key}/*", "/${each.key}"]
    }
  }
}

/* -------------------------------------------------------------- services */

resource "aws_ecs_service" "service" {
  for_each = var.service_config

  name            = "${var.project}-${each.key}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.service[each.key].arn
  desired_count   = each.value.desired_count
  launch_type     = "FARGATE"

  # Keep full capacity during a deploy. A rewrite in flight when a task is
  # replaced is a clinician seeing an error, so old tasks drain rather than stop.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.service[each.key].arn
    container_name   = each.key
    container_port   = each.value.port
  }

  health_check_grace_period_seconds = 60
  enable_execute_command            = var.environment != "production"

  depends_on = [aws_lb_listener_rule.service]

  lifecycle {
    # The deploy pipeline updates the image tag out of band, so Terraform must
    # not revert a rollout it did not perform.
    ignore_changes = [task_definition, desired_count]
  }

  tags = { Name = "${var.project}-${each.key}" }
}

/* ------------------------------------------------------------- autoscaling */

resource "aws_appautoscaling_target" "service" {
  for_each = var.service_config

  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.service[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = each.value.desired_count
  max_capacity       = each.value.desired_count * 5
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each = var.service_config

  name               = "${local.name}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.service[each.key].service_namespace
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    target_value = 65
    # Discharge volume arrives in shift-change waves. Scale out quickly, then
    # hold capacity long enough to absorb the next one.
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

/* --------------------------------------------------------------- outputs */

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "internal_alb_dns" {
  value = aws_lb.internal.dns_name
}

output "ecr_repository_urls" {
  value = { for key, repo in aws_ecr_repository.service : key => repo.repository_url }
}
