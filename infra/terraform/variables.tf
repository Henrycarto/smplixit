variable "project" {
  description = "Resource name prefix"
  type        = string
  default     = "smplixit"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.40.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones. Two minimum, required by RDS multi-AZ and the ALB."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]

  validation {
    condition     = length(var.availability_zones) >= 2
    error_message = "At least two availability zones are required."
  }
}

variable "image_tag" {
  description = "Container image tag to deploy. The deploy pipeline passes the commit SHA."
  type        = string
  default     = "latest"
}

variable "service_config" {
  description = "Per-service task sizing and port."
  type = map(object({
    port          = number
    cpu           = number
    memory        = number
    desired_count = number
  }))

  default = {
    # Core carries the model round trip and holds the request open for the
    # duration of the rewrite loop, so it gets the largest allocation.
    core = {
      port          = 8001
      cpu           = 1024
      memory        = 2048
      desired_count = 2
    }
    poly = {
      port          = 8002
      cpu           = 512
      memory        = 1024
      desired_count = 2
    }
    # Guard is CPU-light but sits on the critical path for every rewrite, so it
    # runs at the same count as Core to avoid becoming the queue.
    guard = {
      port          = 8003
      cpu           = 512
      memory        = 1024
      desired_count = 2
    }
  }
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage" {
  description = "Initial RDS storage in GB"
  type        = number
  default     = 50
}

variable "db_backup_retention_days" {
  description = "Automated backup retention. PHI audit data justifies the longer window."
  type        = number
  default     = 30
}

variable "log_retention_days" {
  description = "CloudWatch log retention"
  type        = number
  default     = 90
}

variable "tags" {
  description = "Tags applied to every resource"
  type        = map(string)
  default = {
    Application = "smplixit"
    ManagedBy   = "terraform"
    DataClass   = "phi"
  }
}
