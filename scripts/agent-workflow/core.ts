import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { userInfo } from "node:os";

import picomatch from "picomatch";
import { parseDocument } from "yaml";

import {
  TASK_RISKS,
  TASK_STATUSES,
  TASK_TYPES,
  type CheckIssue,
  type CheckResult,
  type TaskContract,
  type TaskState,
  type ValidationResult,
} from "./types";

type GitResult = { status: number; stdout: string; stderr: string };

export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly code = "WORKFLOW_ERROR",
  ) {
    super(message);
  }
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function runGit(
  cwd: string,
  args: string[],
  options: { allowFailure?: boolean } = {},
): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const status = result.status ?? 1;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (status !== 0 && !options.allowFailure) {
    throw new WorkflowError(
      `git ${args.join(" ")} failed (${status}): ${sanitizeOutput(stderr || stdout)}`,
      "GIT_COMMAND_FAILED",
    );
  }
  return { status, stdout, stderr };
}

export function findRepoRoot(cwd = process.cwd()): string {
  return runGit(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim();
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function acquireTaskLock(repoRoot: string, taskId: string, action: string): () => void {
  const commonDirRaw = runGit(repoRoot, ["rev-parse", "--git-common-dir"]).stdout.trim();
  const commonDir = resolve(repoRoot, commonDirRaw);
  const lockDirectory = join(commonDir, "agent-workflow-locks");
  const lockPath = join(lockDirectory, `${taskId}.lock`);
  mkdirSync(lockDirectory, { recursive: true });
  const token = randomUUID();

  const createLock = (): void => {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      writeFileSync(
        fd,
        `${JSON.stringify({ task_id: taskId, action, pid: process.pid, token, created_at: new Date().toISOString() }, null, 2)}\n`,
      );
      closeSync(fd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let existing: { pid?: number; action?: string; created_at?: string } = {};
      try {
        existing = JSON.parse(readFileSync(lockPath, "utf8")) as typeof existing;
      } catch {
        // A malformed lock remains authoritative until it is old enough to be safely stale.
      }
      const ageMs = Date.now() - statSync(lockPath).mtimeMs;
      const stale = existing.pid ? !processIsAlive(existing.pid) : ageMs > 60 * 60 * 1000;
      if (stale) {
        rmSync(lockPath, { force: true });
        createLock();
        return;
      }
      throw new WorkflowError(
        `Task '${taskId}' is locked by ${existing.action ?? "another workflow action"} (pid ${existing.pid ?? "unknown"}). Wait for it to finish or investigate the live process.`,
        "TASK_LOCKED",
      );
    }
  };

  createLock();
  return () => {
    if (!existsSync(lockPath)) return;
    try {
      const existing = JSON.parse(readFileSync(lockPath, "utf8")) as { token?: string };
      if (existing.token === token) rmSync(lockPath, { force: true });
    } catch {
      // Never remove a lock that can no longer be proven to belong to this process.
    }
  };
}

export function currentBranch(cwd: string): string {
  return runGit(cwd, ["branch", "--show-current"]).stdout.trim();
}

export function resolveBaseRef(repoRoot: string, baseBranch: string): string {
  const remote = `refs/remotes/origin/${baseBranch}`;
  if (runGit(repoRoot, ["show-ref", "--verify", "--quiet", remote], { allowFailure: true }).status === 0) {
    return `origin/${baseBranch}`;
  }
  const local = `refs/heads/${baseBranch}`;
  if (runGit(repoRoot, ["show-ref", "--verify", "--quiet", local], { allowFailure: true }).status === 0) {
    return baseBranch;
  }
  throw new WorkflowError(`Declared base branch '${baseBranch}' does not exist locally or at origin.`, "BASE_BRANCH_MISSING");
}

function taskSearchDirectories(repoRoot: string): string[] {
  return [
    join(repoRoot, ".agent", "tasks", "active"),
    join(repoRoot, ".agent", "tasks", "backlog"),
    join(repoRoot, ".agent", "tasks", "examples"),
    join(repoRoot, ".agent", "completed"),
  ];
}

function yamlFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => join(directory, entry.name));
}

export function listTaskFiles(repoRoot: string): string[] {
  return taskSearchDirectories(repoRoot).flatMap(yamlFiles);
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new WorkflowError(`Task field '${field}' must be a non-empty string.`, "INVALID_TASK");
  }
}

function assertStringArray(value: unknown, field: string, allowEmpty = false): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((entry) => typeof entry !== "string" || entry.trim() === "")
  ) {
    throw new WorkflowError(
      `Task field '${field}' must be ${allowEmpty ? "an" : "a non-empty"} array of non-empty strings.`,
      "INVALID_TASK",
    );
  }
}

function validateBranchName(repoRoot: string, branch: string, field: string): void {
  const result = runGit(repoRoot, ["check-ref-format", "--branch", branch], { allowFailure: true });
  if (result.status !== 0) {
    throw new WorkflowError(`Task field '${field}' is not a valid Git branch name: ${branch}`, "INVALID_TASK");
  }
}

export function validateTaskContract(raw: unknown, repoRoot: string): TaskContract {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new WorkflowError("Task contract must be a YAML mapping.", "INVALID_TASK");
  }
  const value = raw as Record<string, unknown>;
  const stringFields = [
    "id",
    "title",
    "owner",
    "reviewer",
    "base_branch",
    "working_branch",
    "worktree_path",
    "created_at",
    "goal",
    "context",
    "notes",
  ];
  for (const field of stringFields) assertString(value[field], field);

  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(value.id as string)) {
    throw new WorkflowError("Task field 'id' must use lowercase letters, digits, and hyphens.", "INVALID_TASK");
  }
  if (!TASK_STATUSES.includes(value.status as (typeof TASK_STATUSES)[number])) {
    throw new WorkflowError(`Task field 'status' must be one of: ${TASK_STATUSES.join(", ")}.`, "INVALID_TASK");
  }
  if (!TASK_RISKS.includes(value.risk as (typeof TASK_RISKS)[number])) {
    throw new WorkflowError(`Task field 'risk' must be one of: ${TASK_RISKS.join(", ")}.`, "INVALID_TASK");
  }
  if (!TASK_TYPES.includes(value.task_type as (typeof TASK_TYPES)[number])) {
    throw new WorkflowError(`Task field 'task_type' must be one of: ${TASK_TYPES.join(", ")}.`, "INVALID_TASK");
  }

  const arrayFields = [
    "non_goals",
    "allowed_paths",
    "protected_paths",
    "required_reading",
    "acceptance",
    "validation",
    "documentation",
    "review_requirements",
  ];
  for (const field of arrayFields) assertStringArray(value[field], field, field === "non_goals" || field === "documentation");

  for (const field of ["full_validation_required", "deployment_authorized", "merge_authorized"]) {
    if (typeof value[field] !== "boolean") {
      throw new WorkflowError(`Task field '${field}' must be true or false.`, "INVALID_TASK");
    }
  }

  if (!isAbsolute(value.worktree_path as string)) {
    throw new WorkflowError("Task field 'worktree_path' must be an absolute path.", "INVALID_TASK");
  }
  validateBranchName(repoRoot, value.base_branch as string, "base_branch");
  validateBranchName(repoRoot, value.working_branch as string, "working_branch");
  if (["main", "develop"].includes(value.working_branch as string)) {
    throw new WorkflowError("A task working branch cannot be main or develop.", "INVALID_TASK");
  }
  if (!/^(feature|fix|chore|security|docs|test)\//.test(value.working_branch as string)) {
    throw new WorkflowError(
      "Task working_branch must start with feature/, fix/, chore/, security/, docs/, or test/.",
      "INVALID_TASK",
    );
  }
  if (Number.isNaN(Date.parse(value.created_at as string))) {
    throw new WorkflowError("Task field 'created_at' must be an ISO-8601 date or timestamp.", "INVALID_TASK");
  }
  return value as TaskContract;
}

export function readTaskFile(file: string, repoRoot: string): TaskContract {
  const document = parseDocument(readFileSync(file, "utf8"));
  if (document.errors.length > 0) {
    throw new WorkflowError(
      `Invalid YAML in ${relative(repoRoot, file)}: ${document.errors.map((error) => error.message).join("; ")}`,
      "INVALID_YAML",
    );
  }
  return validateTaskContract(document.toJS(), repoRoot);
}

export function resolveTask(
  repoRoot: string,
  taskArg?: string,
  options: { allowExample?: boolean } = {},
): { file: string; task: TaskContract } {
  let candidates: string[] = [];
  if (taskArg) {
    const direct = resolve(repoRoot, taskArg);
    if (existsSync(direct) && statSync(direct).isFile()) {
      candidates = [direct];
    } else {
      candidates = listTaskFiles(repoRoot).filter((file) => {
        if (basename(file).replace(/\.ya?ml$/i, "") === taskArg) return true;
        try {
          return readTaskFile(file, repoRoot).id === taskArg;
        } catch {
          return false;
        }
      });
    }
  } else {
    const branch = currentBranch(repoRoot);
    candidates = listTaskFiles(repoRoot).filter((file) => {
      try {
        return readTaskFile(file, repoRoot).working_branch === branch;
      } catch {
        return false;
      }
    });
  }

  if (candidates.length === 0) {
    throw new WorkflowError(
      taskArg ? `No task contract found for '${taskArg}'.` : "No task contract matches the current branch.",
      "TASK_NOT_FOUND",
    );
  }
  if (candidates.length > 1) {
    throw new WorkflowError(
      `Task resolution is ambiguous: ${candidates.map((file) => relative(repoRoot, file)).join(", ")}`,
      "TASK_AMBIGUOUS",
    );
  }
  const file = candidates[0];
  if (!options.allowExample && file.includes(`${sep}examples${sep}`)) {
    throw new WorkflowError("Example task contracts cannot be started or completed.", "EXAMPLE_TASK");
  }
  return { file, task: readTaskFile(file, repoRoot) };
}

export function updateTaskFile(
  file: string,
  updates: Partial<Record<keyof TaskContract, unknown>>,
): void {
  const document = parseDocument(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(updates)) document.set(key, value);
  writeFileSync(file, document.toString({ lineWidth: 0 }));
}

export function taskStatePath(repoRoot: string, taskId: string): string {
  return join(repoRoot, ".agent", "state", `${taskId}.json`);
}

export function writeTaskState(repoRoot: string, state: TaskState): string {
  const path = taskStatePath(repoRoot, state.task_id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
  return path;
}

export function readTaskState(repoRoot: string, taskId: string): TaskState | null {
  const path = taskStatePath(repoRoot, taskId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as TaskState;
}

export type WorktreeRecord = {
  worktree: string;
  head: string;
  branch: string | null;
  bare: boolean;
  detached: boolean;
};

export function listWorktrees(repoRoot: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let current: Partial<WorktreeRecord> = {};
  for (const line of runGit(repoRoot, ["worktree", "list", "--porcelain"]).stdout.split(/\r?\n/)) {
    if (line === "") {
      if (current.worktree) {
        records.push({
          worktree: current.worktree,
          head: current.head ?? "",
          branch: current.branch ?? null,
          bare: current.bare ?? false,
          detached: current.detached ?? false,
        });
      }
      current = {};
    } else if (line.startsWith("worktree ")) current.worktree = line.slice(9);
    else if (line.startsWith("HEAD ")) current.head = line.slice(5);
    else if (line.startsWith("branch ")) current.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "bare") current.bare = true;
    else if (line === "detached") current.detached = true;
  }
  if (current.worktree) {
    records.push({
      worktree: current.worktree,
      head: current.head ?? "",
      branch: current.branch ?? null,
      bare: current.bare ?? false,
      detached: current.detached ?? false,
    });
  }
  return records;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    try {
      return realpathSync(value);
    } catch {
      return resolve(value);
    }
  };
  return normalize(left) === normalize(right);
}

function moveTaskToActive(targetRoot: string, task: TaskContract): string {
  const matches = listTaskFiles(targetRoot).filter((file) => {
    try {
      return readTaskFile(file, targetRoot).id === task.id;
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) {
    throw new WorkflowError(
      `The new worktree must contain exactly one copy of task '${task.id}', found ${matches.length}. Commit the task contract to ${task.base_branch} before starting it.`,
      "TASK_NOT_IN_BASE",
    );
  }
  const source = matches[0];
  const activeDirectory = join(targetRoot, ".agent", "tasks", "active");
  mkdirSync(activeDirectory, { recursive: true });
  const target = join(activeDirectory, `${task.id}.yaml`);
  if (!samePath(source, target)) {
    if (existsSync(target)) {
      throw new WorkflowError(`Active task path already exists: ${target}`, "TASK_PATH_CONFLICT");
    }
    renameSync(source, target);
  }
  updateTaskFile(target, { status: "active" });
  return target;
}

export type StartResult = {
  task_id: string;
  reused: boolean;
  branch: string;
  worktree: string;
  base_ref: string;
  base_commit: string;
  task_file: string;
  state_file: string;
  next_instructions: string[];
};

export function startTask(repoRoot: string, taskArg: string): StartResult {
  const { task } = resolveTask(repoRoot, taskArg);
  if (!(["backlog", "ready"] as string[]).includes(task.status)) {
    throw new WorkflowError(`Task '${task.id}' has status '${task.status}', not backlog or ready.`, "TASK_NOT_STARTABLE");
  }

  const releaseLock = acquireTaskLock(repoRoot, task.id, "start");
  try {

    runGit(repoRoot, ["fetch", "origin"]);
  const baseRef = resolveBaseRef(repoRoot, task.base_branch);
  const baseCommit = runGit(repoRoot, ["rev-parse", baseRef]).stdout.trim();
  const worktrees = listWorktrees(repoRoot);
  const pathRecord = worktrees.find((record) => samePath(record.worktree, task.worktree_path));
  const branchRecord = worktrees.find((record) => record.branch === task.working_branch);
  let reused = false;

  if (pathRecord || branchRecord) {
    if (
      pathRecord &&
      branchRecord &&
      samePath(pathRecord.worktree, branchRecord.worktree) &&
      pathRecord.branch === task.working_branch
    ) {
      reused = true;
    } else {
      throw new WorkflowError(
        `Declared branch or worktree is already in use by unrelated state. Branch record: ${branchRecord?.worktree ?? "none"}; path branch: ${pathRecord?.branch ?? "none"}.`,
        "WORKTREE_CONFLICT",
      );
    }
  } else if (existsSync(task.worktree_path)) {
    throw new WorkflowError(`Worktree path already exists and is not a registered Git worktree: ${task.worktree_path}`, "WORKTREE_PATH_EXISTS");
  } else {
    mkdirSync(dirname(task.worktree_path), { recursive: true });
    const localBranchExists =
      runGit(repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${task.working_branch}`], { allowFailure: true })
        .status === 0;
    const remoteBranchExists =
      runGit(repoRoot, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${task.working_branch}`], {
        allowFailure: true,
      }).status === 0;
    if (localBranchExists) {
      runGit(repoRoot, ["worktree", "add", task.worktree_path, task.working_branch]);
    } else if (remoteBranchExists) {
      runGit(repoRoot, [
        "worktree",
        "add",
        "--track",
        "-b",
        task.working_branch,
        task.worktree_path,
        `origin/${task.working_branch}`,
      ]);
    } else {
      runGit(repoRoot, ["worktree", "add", "-b", task.working_branch, task.worktree_path, baseRef]);
    }
  }

  const activeFile = moveTaskToActive(task.worktree_path, task);
  const now = new Date().toISOString();
  const state = writeTaskState(task.worktree_path, {
    task_id: task.id,
    task_file: relative(task.worktree_path, activeFile),
    base_branch: task.base_branch,
    base_commit: baseCommit,
    working_branch: task.working_branch,
    worktree_path: task.worktree_path,
    created_at: now,
    updated_at: now,
    started_by: userInfo().username,
    status: "active",
  });

    return {
      task_id: task.id,
      reused,
      branch: task.working_branch,
      worktree: task.worktree_path,
      base_ref: baseRef,
      base_commit: baseCommit,
      task_file: activeFile,
      state_file: state,
      next_instructions: [
        `cd ${quoteShell(task.worktree_path)}`,
        `Read AGENTS.md and ${relative(task.worktree_path, activeFile)} before editing.`,
        "Verify the branch and commit the task-start metadata before implementation.",
        `Run npm run agent:check -- ${task.id} before claiming completion.`,
      ],
    };
  } finally {
    releaseLock();
  }
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function dirtyFiles(cwd: string): string[] {
  return runGit(cwd, ["status", "--porcelain=v1", "--untracked-files=all"])
    .stdout.split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3));
}

function changedFiles(repoRoot: string, mergeBase: string, headRef = "HEAD"): string[] {
  const committed = splitLines(
    runGit(repoRoot, ["diff", "--name-only", "--diff-filter=ACMRD", `${mergeBase}...${headRef}`]).stdout,
  );
  if (headRef !== "HEAD") return [...new Set(committed)].sort();
  const staged = splitLines(runGit(repoRoot, ["diff", "--cached", "--name-only", "--diff-filter=ACMRD"]).stdout);
  const unstaged = splitLines(runGit(repoRoot, ["diff", "--name-only", "--diff-filter=ACMRD"]).stdout);
  const untracked = splitLines(runGit(repoRoot, ["ls-files", "--others", "--exclude-standard"]).stdout);
  return [...new Set([...committed, ...staged, ...unstaged, ...untracked])].sort();
}

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => picomatch.isMatch(path, pattern, { dot: true }));
}

const SECRET_FILE_PATTERN = /(^|\/)(?:\.env(?:$|\.)|[^/]+\.(?:pem|key|p12|pfx|jks|keystore)$)/i;
const SECRET_FILE_EXAMPLE_PATTERN = /(^|\/)\.env(?:\.[^/]*)?\.example$|(^|\/)\.env\.example$/i;
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: "Stripe live secret", pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
];

function lineNumber(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function inspectChangedContent(repoRoot: string, files: string[]): CheckIssue[] {
  const issues: CheckIssue[] = [];
  for (const file of files) {
    const absolute = join(repoRoot, file);
    if (!existsSync(absolute) || !lstatSync(absolute).isFile() || statSync(absolute).size > 1_000_000) continue;
    const content = readFileSync(absolute, "utf8");
    const marker = /^(<<<<<<< .+|>>>>>>> .+)$/m.exec(content);
    if (marker) {
      issues.push({
        code: "MERGE_MARKER",
        severity: "P0",
        message: "Unresolved merge-conflict marker detected.",
        file,
        line: lineNumber(content, marker.index),
      });
    }
    for (const secret of SECRET_PATTERNS) {
      const match = secret.pattern.exec(content);
      if (match) {
        issues.push({
          code: "CREDENTIAL_PATTERN",
          severity: "P0",
          message: `${secret.name} pattern detected in changed content.`,
          file,
          line: lineNumber(content, match.index),
        });
      }
    }
  }
  return issues;
}

export function sanitizeOutput(value: string, limit = 1800): string {
  const redacted = value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]+$/g, "")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_SLACK_TOKEN]")
    .replace(/\bsk_(?:live|test)_[A-Za-z0-9]{10,}\b/g, "[REDACTED_STRIPE_KEY]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_GOOGLE_KEY]")
    .replace(/(postgres(?:ql)?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/((?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]")
    .trim();
  if (redacted.length <= limit) return redacted || "(no output)";
  return `${redacted.slice(0, limit)}\n… output truncated …`;
}

export function runValidationCommand(command: string, cwd: string): ValidationResult {
  const startedAt = new Date();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 10 * 1024 * 1024,
  });
  const endedAt = new Date();
  const exitCode = result.status ?? 1;
  return {
    command,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    exit_code: exitCode,
    stdout_summary: sanitizeOutput(result.stdout ?? ""),
    stderr_summary: sanitizeOutput(result.stderr ?? ""),
    passed: exitCode === 0,
  };
}

export function checkTask(
  repoRoot: string,
  task: TaskContract,
  options: {
    taskFile?: string;
    runValidation?: boolean;
    requireClean?: boolean;
    ciMode?: boolean;
    headRef?: string;
  } = {},
): CheckResult {
  const ciMode = options.ciMode ?? false;
  const headRef = options.headRef ?? "HEAD";
  const branch = ciMode ? task.working_branch : currentBranch(repoRoot);
  const baseRef = resolveBaseRef(repoRoot, task.base_branch);
  const baseCommit = runGit(repoRoot, ["rev-parse", baseRef]).stdout.trim();
  const mergeBase = runGit(repoRoot, ["merge-base", baseRef, headRef]).stdout.trim();
  const changed = changedFiles(repoRoot, mergeBase, headRef);
  const dirty = headRef === "HEAD" ? dirtyFiles(repoRoot) : [];
  const issues: CheckIssue[] = [];

  if (!ciMode && branch !== task.working_branch) {
    issues.push({
      code: "BRANCH_MISMATCH",
      severity: "P0",
      message: `Current branch '${branch}' does not match task branch '${task.working_branch}'.`,
    });
  }
  if (!ciMode && !samePath(repoRoot, task.worktree_path)) {
    issues.push({
      code: "WORKTREE_MISMATCH",
      severity: "P0",
      message: `Current worktree '${repoRoot}' does not match '${task.worktree_path}'.`,
    });
  }
  if (options.requireClean !== false && dirty.length > 0) {
    issues.push({
      code: "DIRTY_WORKTREE",
      severity: "P1",
      message: `Worktree has ${dirty.length} uncommitted path(s): ${dirty.join(", ")}`,
    });
  }

  for (const file of changed) {
    if (matchesAny(file, task.protected_paths)) {
      issues.push({
        code: "PROTECTED_PATH",
        severity: "P0",
        message: "Changed path matches a protected_paths rule.",
        file,
      });
    } else if (!matchesAny(file, task.allowed_paths)) {
      issues.push({
        code: "UNAUTHORIZED_PATH",
        severity: "P1",
        message: "Changed path does not match any allowed_paths rule.",
        file,
      });
    }
    if (SECRET_FILE_PATTERN.test(file) && !SECRET_FILE_EXAMPLE_PATTERN.test(file)) {
      issues.push({
        code: "SECRET_FILE",
        severity: "P0",
        message: "Committed or changed secret-bearing file type is forbidden.",
        file,
      });
    }
  }
  issues.push(...inspectChangedContent(repoRoot, changed));

  const state = readTaskState(repoRoot, task.id);
  if (!state) {
    issues.push({
      code: "TASK_STATE_MISSING",
      severity: "P1",
      message: `Missing .agent/state/${task.id}.json metadata.`,
    });
  } else {
    const recordedBaseIsKnown =
      runGit(repoRoot, ["cat-file", "-e", `${state.base_commit}^{commit}`], { allowFailure: true }).status === 0;
    const recordedBaseIsAncestor =
      recordedBaseIsKnown &&
      runGit(repoRoot, ["merge-base", "--is-ancestor", state.base_commit, mergeBase], { allowFailure: true }).status === 0;
    if (!recordedBaseIsAncestor) {
      issues.push({
        code: "BASE_METADATA_DRIFT",
        severity: "P2",
        message: `Recorded base ${state.base_commit} is missing or is not an ancestor of merge base ${mergeBase}.`,
      });
    }
    if (state.working_branch !== task.working_branch || !samePath(state.worktree_path, task.worktree_path)) {
      issues.push({
        code: "TASK_STATE_CONFLICT",
        severity: "P0",
        message: "Task state branch/worktree metadata conflicts with the task contract.",
      });
    }
  }

  if (!task.merge_authorized) {
    const merged = runGit(repoRoot, ["merge-base", "--is-ancestor", headRef, baseRef], { allowFailure: true }).status === 0;
    const headCommit = runGit(repoRoot, ["rev-parse", headRef]).stdout.trim();
    const advancedBeyondRecordedBase = state ? headCommit !== state.base_commit : headCommit !== mergeBase;
    if (merged && branch !== task.base_branch && advancedBeyondRecordedBase) {
      issues.push({
        code: "MERGE_AUTHORIZATION_EXCEEDED",
        severity: "P0",
        message: "Task branch appears merged into its base while merge_authorized is false.",
      });
    }
  }
  if (!task.deployment_authorized && ["main", "production"].includes(branch)) {
    issues.push({
      code: "DEPLOYMENT_AUTHORIZATION_EXCEEDED",
      severity: "P0",
      message: "Task is on a production branch while deployment_authorized is false.",
    });
  }

  const validation = options.runValidation
    ? task.validation.map((command) => runValidationCommand(command, repoRoot))
    : [];
  for (const result of validation) {
    if (!result.passed) {
      issues.push({
        code: "VALIDATION_FAILED",
        severity: "P1",
        message: `Validation failed (${result.exit_code}): ${result.command}`,
      });
    }
  }

  return {
    ok: issues.length === 0,
    task_id: task.id,
    branch,
    worktree: repoRoot,
    base_ref: baseRef,
    base_commit: baseCommit,
    merge_base: mergeBase,
    changed_files: changed,
    dirty_files: dirty,
    issues,
    validation,
  };
}

function markdownCode(value: string): string {
  return `\`${value.replaceAll("`", "\\`")}\``;
}

function listOrNone(values: string[], formatter = (value: string) => value): string {
  return values.length > 0 ? values.map((value) => `- ${formatter(value)}`).join("\n") : "- None";
}

function validationMarkdown(results: ValidationResult[]): string {
  if (results.length === 0) return "- No validation commands ran.";
  return results
    .map(
      (result) =>
        `### ${markdownCode(result.command)}\n\n` +
        `- Start: ${result.started_at}\n` +
        `- End: ${result.ended_at}\n` +
        `- Exit code: ${result.exit_code}\n` +
        `- Result: ${result.passed ? "PASS" : "FAIL"}\n` +
        `- Stdout summary:\n\n\`\`\`text\n${result.stdout_summary}\n\`\`\`\n` +
        `- Stderr summary:\n\n\`\`\`text\n${result.stderr_summary}\n\`\`\``,
    )
    .join("\n\n");
}

export function completionMarkdown(args: {
  task: TaskContract;
  state: TaskState | null;
  finalCommit: string;
  changedFiles: string[];
  validation: ValidationResult[];
  status: "COMPLETED" | "BLOCKED";
  reviewFindingsResolved?: string[];
}): string {
  const { task, state, finalCommit, changedFiles, validation, status } = args;
  const failed = validation.filter((result) => !result.passed);
  return `# Completion: ${task.id}\n\n` +
    `## Task metadata\n\n` +
    `- Task ID: ${task.id}\n` +
    `- Status: ${status}\n` +
    `- Owner: ${task.owner}\n` +
    `- Reviewer: ${task.reviewer}\n` +
    `- Branch: ${task.working_branch}\n` +
    `- Worktree: ${task.worktree_path}\n` +
    `- Base branch: ${task.base_branch}\n` +
    `- Base commit: ${state?.base_commit ?? "UNKNOWN"}\n` +
    `- Final commit: ${finalCommit}\n` +
    `- Timestamp: ${new Date().toISOString()}\n\n` +
    `## Changed files\n\n${listOrNone(changedFiles, markdownCode)}\n\n` +
    `## Behavior changed\n\n- ${task.goal}\n\n` +
    `## Behavior intentionally unchanged\n\n${listOrNone(task.non_goals)}\n\n` +
    `## Acceptance criteria results\n\n${task.acceptance.map((criterion) => `- ${status === "COMPLETED" ? "PASS" : "NOT COMPLETE"}: ${criterion}`).join("\n")}\n\n` +
    `## Validation commands and evidence\n\n${validationMarkdown(validation)}\n\n` +
    `## Introduced versus pre-existing failures\n\n` +
    (failed.length === 0
      ? "- No validation failures were observed.\n"
      : "- Failures remain unclassified unless a separate clean-base run proves they are pre-existing. This report makes no unsupported pre-existing-failure claim.\n") +
    `\n## Tests added or changed\n\n- See the changed-file list and validation evidence; the CLI does not infer test intent.\n\n` +
    `## Review findings resolved\n\n${listOrNone(args.reviewFindingsResolved ?? [])}\n\n` +
    `## Known limitations\n\n- Semantic correctness still requires the independent reviewer named in the task contract.\n\n` +
    `## Documentation changed\n\n${listOrNone(task.documentation)}\n\n` +
    `## Deployment status\n\n- ${task.deployment_authorized ? "Authorized by contract but not performed by agent:finish." : "Not authorized and not performed."}\n\n` +
    `## Merge status\n\n- ${task.merge_authorized ? "Authorized by contract but not performed by agent:finish." : "Not authorized and not performed."}\n\n` +
    `## Review focus\n\n${listOrNone(task.review_requirements)}\n`;
}

export function finishTask(repoRoot: string, taskArg?: string): { report: string; result: CheckResult } {
  const { file, task } = resolveTask(repoRoot, taskArg);
  const releaseLock = acquireTaskLock(repoRoot, task.id, "finish");
  try {
    const precheck = checkTask(repoRoot, task, { taskFile: file, requireClean: true });
  const validation = task.validation.map((command) => runValidationCommand(command, repoRoot));
  const status = precheck.ok && validation.every((result) => result.passed) ? "COMPLETED" : "BLOCKED";
  const issues = [...precheck.issues];
  for (const result of validation) {
    if (!result.passed) {
      issues.push({
        code: "VALIDATION_FAILED",
        severity: "P1",
        message: `Validation failed (${result.exit_code}): ${result.command}`,
      });
    }
  }
  const result: CheckResult = { ...precheck, ok: status === "COMPLETED", issues, validation };
  const finalCommit = runGit(repoRoot, ["rev-parse", "HEAD"]).stdout.trim();
  const state = readTaskState(repoRoot, task.id);
  const reportDirectory = join(repoRoot, ".agent", "completed");
  mkdirSync(reportDirectory, { recursive: true });
  const report = join(reportDirectory, `${task.id}.md`);
  writeFileSync(
    report,
    completionMarkdown({ task, state, finalCommit, changedFiles: result.changed_files, validation, status }),
  );

  updateTaskFile(file, { status: status === "COMPLETED" ? "completed" : "blocked" });
  const targetContract = join(reportDirectory, `${task.id}.yaml`);
  const finalTaskFile = status === "COMPLETED" ? targetContract : file;
  if (status === "COMPLETED" && !samePath(file, targetContract)) {
    if (existsSync(targetContract)) rmSync(targetContract);
    renameSync(file, targetContract);
  }
  const now = new Date().toISOString();
  writeTaskState(repoRoot, {
    ...(state ?? {
      task_id: task.id,
      task_file: relative(repoRoot, finalTaskFile),
      base_branch: task.base_branch,
      base_commit: result.merge_base,
      working_branch: task.working_branch,
      worktree_path: task.worktree_path,
      created_at: now,
      started_by: userInfo().username,
      status: status === "COMPLETED" ? "completed" : "blocked",
    }),
    task_file: relative(repoRoot, finalTaskFile),
    status: status === "COMPLETED" ? "completed" : "blocked",
    final_commit: finalCommit,
    updated_at: now,
  });
    return { report, result };
  } finally {
    releaseLock();
  }
}

export function reviewMarkdown(args: {
  task: TaskContract;
  check: CheckResult;
  reviewedCommit: string;
  approved: boolean;
}): string {
  const findings = args.check.issues;
  const grouped = (["P0", "P1", "P2", "P3"] as const)
    .map((severity) => {
      const matches = findings.filter((finding) => finding.severity === severity);
      return `### ${severity}\n\n${
        matches.length > 0
          ? matches
              .map(
                (finding) =>
                  `- ${finding.code}${finding.file ? ` — ${finding.file}${finding.line ? `:${finding.line}` : ""}` : ""}\n` +
                  `  - Failure scenario: ${finding.message}\n` +
                  `  - Required correction: Resolve the reported policy or validation failure and rerun the review.`,
              )
              .join("\n")
          : "- None found by automated checks."
      }`;
    })
    .join("\n\n");
  const recommendation = args.approved && args.check.ok ? "MERGE READY" : "NOT MERGE READY";
  return `# Review: ${args.task.id}\n\n` +
    `- Task ID: ${args.task.id}\n` +
    `- Reviewer: ${args.task.reviewer}\n` +
    `- Reviewed commit: ${args.reviewedCommit}\n` +
    `- Base commit: ${args.check.merge_base}\n` +
    `- Timestamp: ${new Date().toISOString()}\n\n` +
    `## Scope assessment\n\n- ${args.check.changed_files.length} changed path(s) inspected against allowed_paths.\n\n` +
    `## Unauthorized path assessment\n\n- ${findings.some((finding) => finding.code === "UNAUTHORIZED_PATH" || finding.code === "PROTECTED_PATH") ? "Scope violations found; see findings." : "No automated path-policy violations found."}\n\n` +
    `## Findings by severity\n\n${grouped}\n\n` +
    `## Missing tests\n\n- A semantic reviewer must record any missing behavioral coverage here; automation cannot prove completeness.\n\n` +
    `## Validation performed\n\n${validationMarkdown(args.check.validation)}\n\n` +
    `## Diff artifact\n\n- Full diff: .agent/reviews/${args.task.id}.diff\n\n` +
    `## Final recommendation\n\n- ${recommendation}${args.approved ? " (explicit reviewer attestation supplied)" : " (explicit semantic reviewer attestation still required)"}\n`;
}

export function reviewTask(
  repoRoot: string,
  taskArg?: string,
  approved = false,
): { report: string; diff: string; result: CheckResult } {
  const { file, task } = resolveTask(repoRoot, taskArg);
  const releaseLock = acquireTaskLock(repoRoot, task.id, "review");
  try {
    const result = checkTask(repoRoot, task, { taskFile: file, runValidation: true, requireClean: true });
  const reviewedCommit = runGit(repoRoot, ["rev-parse", "HEAD"]).stdout.trim();
  const reviewDirectory = join(repoRoot, ".agent", "reviews");
  mkdirSync(reviewDirectory, { recursive: true });
  const diff = join(reviewDirectory, `${task.id}.diff`);
  const containsSecretFinding = result.issues.some(
    (issue) => issue.code === "SECRET_FILE" || issue.code === "CREDENTIAL_PATTERN",
  );
  const rawDiff = containsSecretFinding
    ? "Full diff withheld because automated checks detected a possible secret. Review the Git diff in a secure local environment, remove the secret, rotate it if real, and rerun review.\n"
    : runGit(repoRoot, [
        "diff",
        "--no-ext-diff",
        `${result.merge_base}...HEAD`,
        "--",
        ".",
        `:(exclude).agent/reviews/${task.id}.diff`,
        `:(exclude).agent/reviews/${task.id}.md`,
      ]).stdout;
  writeFileSync(
    diff,
    rawDiff
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n"),
  );
  const report = join(reviewDirectory, `${task.id}.md`);
  writeFileSync(report, reviewMarkdown({ task, check: result, reviewedCommit, approved }));
    return { report, diff, result };
  } finally {
    releaseLock();
  }
}

export type StatusEntry = {
  id: string;
  title: string;
  owner: string;
  reviewer: string;
  branch: string;
  worktree: string;
  status: string;
  risk: string;
  reconciliation: "ok" | "missing" | "conflicting" | "stale";
  modified: boolean | null;
  details: string[];
};

export function taskStatus(repoRoot: string, includeAll = false): StatusEntry[] {
  const directories = includeAll
    ? taskSearchDirectories(repoRoot)
    : [join(repoRoot, ".agent", "tasks", "active")];
  const files = directories.flatMap(yamlFiles);
  const worktrees = listWorktrees(repoRoot);
  return files.map((file) => {
    const task = readTaskFile(file, repoRoot);
    const pathRecord = worktrees.find((record) => samePath(record.worktree, task.worktree_path));
    const branchRecord = worktrees.find((record) => record.branch === task.working_branch);
    const details: string[] = [];
    let reconciliation: StatusEntry["reconciliation"] = "ok";
    if (!pathRecord && !branchRecord) {
      if (task.status === "backlog" || task.status === "ready") {
        details.push("Task is not started; no worktree is expected yet.");
      } else {
        reconciliation = "missing";
        details.push("No registered worktree or checked-out branch matches the active contract.");
      }
    } else if (!pathRecord || !branchRecord || !samePath(pathRecord.worktree, branchRecord.worktree)) {
      reconciliation = "conflicting";
      details.push("Declared branch and worktree resolve to different Git worktree records.");
    }
    let modified: boolean | null = null;
    if (pathRecord && existsSync(pathRecord.worktree)) {
      modified = dirtyFiles(pathRecord.worktree).length > 0;
      if (modified) details.push("Worktree has uncommitted changes.");
      const actualHead = runGit(pathRecord.worktree, ["rev-parse", "HEAD"]).stdout.trim();
      const state = readTaskState(pathRecord.worktree, task.id);
      if (state && state.base_commit === actualHead && task.status === "active") {
        details.push("Task worktree has not advanced beyond its recorded base commit.");
      }
    }
    return {
      id: task.id,
      title: task.title,
      owner: task.owner,
      reviewer: task.reviewer,
      branch: task.working_branch,
      worktree: task.worktree_path,
      status: task.status,
      risk: task.risk,
      reconciliation,
      modified,
      details,
    };
  });
}

export type CleanupResult = {
  task_id: string;
  worktree: string;
  branch: string;
  removed_worktree: boolean;
  pruned: boolean;
  deleted_branch: boolean;
  checks: {
    dirty: boolean;
    unpushed: boolean;
    merged: boolean;
    complete: boolean;
  };
};

export function cleanupTask(
  repoRoot: string,
  taskArg: string,
  options: { dangerous?: boolean; deleteBranch?: boolean } = {},
): CleanupResult {
  const { task } = resolveTask(repoRoot, taskArg);
  const releaseLock = acquireTaskLock(repoRoot, task.id, "cleanup");
  try {
    const record = listWorktrees(repoRoot).find((entry) => samePath(entry.worktree, task.worktree_path));
  if (!record) throw new WorkflowError(`Declared worktree is not registered: ${task.worktree_path}`, "WORKTREE_MISSING");
  if (record.branch !== task.working_branch) {
    throw new WorkflowError(`Worktree branch '${record.branch}' does not match '${task.working_branch}'.`, "WORKTREE_CONFLICT");
  }
  if (samePath(record.worktree, repoRoot)) {
    throw new WorkflowError("Run cleanup from a different repository worktree; a worktree cannot remove itself safely.", "SELF_CLEANUP");
  }
  const dirty = dirtyFiles(record.worktree).length > 0;
  const baseRef = resolveBaseRef(repoRoot, task.base_branch);
  const merged = runGit(repoRoot, ["merge-base", "--is-ancestor", task.working_branch, baseRef], { allowFailure: true }).status === 0;
  let unpushed = true;
  const upstream = runGit(repoRoot, ["rev-parse", "--abbrev-ref", `${task.working_branch}@{upstream}`], {
    allowFailure: true,
  });
  if (upstream.status === 0) {
    unpushed = runGit(repoRoot, ["rev-list", "--count", `${upstream.stdout.trim()}..${task.working_branch}`]).stdout.trim() !== "0";
  } else {
    const remoteRef = `refs/remotes/origin/${task.working_branch}`;
    if (runGit(repoRoot, ["show-ref", "--verify", "--quiet", remoteRef], { allowFailure: true }).status === 0) {
      unpushed = runGit(repoRoot, ["rev-list", "--count", `origin/${task.working_branch}..${task.working_branch}`]).stdout.trim() !== "0";
    }
  }
  const complete = task.status === "completed" && existsSync(join(repoRoot, ".agent", "completed", `${task.id}.md`));
  const blockers = [dirty && "dirty worktree", unpushed && "unpushed commits", !merged && "unmerged branch", !complete && "incomplete task"].filter(Boolean);
  if (blockers.length > 0 && !options.dangerous) {
    throw new WorkflowError(`Cleanup refused: ${blockers.join(", ")}.`, "CLEANUP_REFUSED");
  }
  runGit(repoRoot, ["worktree", "remove", ...(options.dangerous ? ["--force"] : []), task.worktree_path]);
  runGit(repoRoot, ["worktree", "prune"]);
  let deletedBranch = false;
  if (options.deleteBranch) {
    if (!options.dangerous && !merged) {
      throw new WorkflowError("Refusing to delete an unmerged branch without --dangerous.", "BRANCH_DELETE_REFUSED");
    }
    runGit(repoRoot, ["branch", options.dangerous ? "-D" : "-d", task.working_branch]);
    deletedBranch = true;
  }
    return {
      task_id: task.id,
      worktree: task.worktree_path,
      branch: task.working_branch,
      removed_worktree: true,
      pruned: true,
      deleted_branch: deletedBranch,
      checks: { dirty, unpushed, merged, complete },
    };
  } finally {
    releaseLock();
  }
}

export function ciCheck(repoRoot: string, baseBranch?: string): { skipped: boolean; message: string; result?: CheckResult } {
  const branch = process.env.GITHUB_HEAD_REF || currentBranch(repoRoot);
  const matching = listTaskFiles(repoRoot).filter((file) => {
    try {
      return readTaskFile(file, repoRoot).working_branch === branch;
    } catch {
      return false;
    }
  });
  if (matching.length === 0) {
    return { skipped: true, message: `No task contract declares branch '${branch}'; changed-path policy is not applicable.` };
  }
  if (matching.length > 1) throw new WorkflowError(`Multiple task contracts declare branch '${branch}'.`, "TASK_AMBIGUOUS");
  const task = readTaskFile(matching[0], repoRoot);
  if (baseBranch && task.base_branch !== baseBranch) {
    throw new WorkflowError(
      `Task base '${task.base_branch}' does not match CI base '${baseBranch}'.`,
      "BASE_BRANCH_MISMATCH",
    );
  }
  const result = checkTask(repoRoot, task, { ciMode: true, requireClean: true });
  return { skipped: false, message: result.ok ? "Task contract and changed-path policy passed." : "Task policy failed.", result };
}

export function removePathIfExists(path: string): void {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}
