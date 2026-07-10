export const TASK_STATUSES = [
  "backlog",
  "ready",
  "active",
  "blocked",
  "in_review",
  "completed",
  "abandoned",
] as const;

export const TASK_RISKS = ["low", "medium", "high", "critical"] as const;

export const TASK_TYPES = [
  "ui",
  "frontend",
  "backend",
  "database",
  "marketplace",
  "billing",
  "inventory",
  "security",
  "infrastructure",
  "documentation",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskRisk = (typeof TASK_RISKS)[number];
export type TaskType = (typeof TASK_TYPES)[number];

export type TaskContract = {
  id: string;
  title: string;
  status: TaskStatus;
  owner: string;
  reviewer: string;
  risk: TaskRisk;
  task_type: TaskType;
  base_branch: string;
  working_branch: string;
  worktree_path: string;
  created_at: string;
  goal: string;
  context: string;
  non_goals: string[];
  allowed_paths: string[];
  protected_paths: string[];
  required_reading: string[];
  acceptance: string[];
  validation: string[];
  full_validation_required: boolean;
  documentation: string[];
  review_requirements: string[];
  deployment_authorized: boolean;
  merge_authorized: boolean;
  notes: string;
};

export type TaskState = {
  task_id: string;
  task_file: string;
  base_branch: string;
  base_commit: string;
  working_branch: string;
  worktree_path: string;
  created_at: string;
  updated_at: string;
  started_by: string;
  status: TaskStatus;
  final_commit?: string;
};

export type ValidationResult = {
  command: string;
  started_at: string;
  ended_at: string;
  exit_code: number;
  stdout_summary: string;
  stderr_summary: string;
  passed: boolean;
};

export type CheckIssue = {
  code: string;
  severity: "P0" | "P1" | "P2" | "P3";
  message: string;
  file?: string;
  line?: number;
};

export type CheckResult = {
  ok: boolean;
  task_id: string;
  branch: string;
  worktree: string;
  base_ref: string;
  base_commit: string;
  merge_base: string;
  changed_files: string[];
  dirty_files: string[];
  issues: CheckIssue[];
  validation: ValidationResult[];
};
