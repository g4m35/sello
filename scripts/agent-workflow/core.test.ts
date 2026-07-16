import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";

import {
  WorkflowError,
  acquireTaskLock,
  checkTask,
  cleanupTask,
  finishTask,
  readTaskFile,
  reviewTask,
  runValidationCommand,
  sanitizeOutput,
  startTask,
  taskStatus,
  validateTaskContract,
  writeTaskState,
} from "./core";
import type { TaskContract } from "./types";

const temporaryRoots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? "").trim();
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function initializeRepo(): { root: string; remote: string; scratch: string } {
  const scratch = mkdtempSync(join(tmpdir(), "sello-agent-workflow-"));
  temporaryRoots.push(scratch);
  const root = join(scratch, "repo");
  const remote = join(scratch, "origin.git");
  mkdirSync(root);
  git(root, "init", "-b", "develop");
  git(root, "config", "user.email", "agent-tests@example.invalid");
  git(root, "config", "user.name", "Agent Workflow Tests");
  write(join(root, "AGENTS.md"), "# Test agent rules\n");
  write(join(root, ".agent", "tasks", "active", ".gitkeep"), "");
  write(join(root, ".agent", "tasks", "backlog", ".gitkeep"), "");
  write(join(root, ".agent", "tasks", "examples", ".gitkeep"), "");
  write(join(root, ".agent", "completed", ".gitkeep"), "");
  write(join(root, ".agent", "reviews", ".gitkeep"), "");
  write(join(root, ".agent", "state", ".gitkeep"), "");
  write(join(root, "src", "components", "seed.ts"), "export const seed = true;\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  mkdirSync(remote);
  git(remote, "init", "--bare");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-u", "origin", "develop");
  return { root, remote, scratch };
}

function contract(root: string, overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    id: "test-task-001",
    title: "Test task",
    status: "ready",
    owner: "Cursor/Grok",
    reviewer: "Codex",
    risk: "low",
    task_type: "frontend",
    base_branch: "develop",
    working_branch: "feature/test-task-001",
    worktree_path: join(dirname(root), "test-task-worktree"),
    created_at: "2026-07-10T00:00:00.000Z",
    goal: "Exercise the workflow without changing product behavior.",
    context: "Temporary test repository.",
    non_goals: ["No deployment."],
    allowed_paths: [".agent/**", "src/components/**"],
    protected_paths: ["prisma/**", "src/app/api/**"],
    required_reading: ["AGENTS.md"],
    acceptance: ["Workflow behavior is deterministic."],
    validation: ["node -e \"process.exit(0)\""],
    full_validation_required: false,
    documentation: [],
    review_requirements: ["Review path policy."],
    deployment_authorized: false,
    merge_authorized: false,
    notes: "Test-only contract.",
    ...overrides,
  };
}

function addReadyTask(root: string, task = contract(root)): string {
  const file = join(root, ".agent", "tasks", "backlog", `${task.id}.yaml`);
  write(file, stringify(task));
  git(root, "add", ".");
  git(root, "commit", "-m", `task: ${task.id}`);
  git(root, "push", "origin", "develop");
  return file;
}

function createActiveBranch(root: string, task = contract(root)): { task: TaskContract; file: string; base: string } {
  addReadyTask(root, task);
  const base = git(root, "rev-parse", "origin/develop");
  git(root, "checkout", "-b", task.working_branch);
  const backlog = join(root, ".agent", "tasks", "backlog", `${task.id}.yaml`);
  const active = join(root, ".agent", "tasks", "active", `${task.id}.yaml`);
  const activeTask = { ...task, status: "active" as const, worktree_path: root };
  rmSync(backlog);
  write(active, stringify(activeTask));
  writeTaskState(root, {
    task_id: task.id,
    task_file: `.agent/tasks/active/${task.id}.yaml`,
    base_branch: task.base_branch,
    base_commit: base,
    working_branch: task.working_branch,
    worktree_path: root,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    started_by: "test",
    status: "active",
  });
  git(root, "add", ".");
  git(root, "commit", "-m", "start task");
  return { task: activeTask, file: active, base };
}

afterEach(() => {
  while (temporaryRoots.length > 0) rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
});

describe("task-contract parsing", () => {
  it("accepts a valid task contract", () => {
    const { root } = initializeRepo();
    expect(validateTaskContract(contract(root), root).id).toBe("test-task-001");
  });

  it("rejects invalid or missing required fields", () => {
    const { root } = initializeRepo();
    expect(() => validateTaskContract({ ...contract(root), allowed_paths: [] }, root)).toThrowError(WorkflowError);
    expect(() => validateTaskContract({ ...contract(root), deployment_authorized: "no" }, root)).toThrowError(
      /deployment_authorized/,
    );
  });

  it("requires an absolute native worktree path and an approved branch prefix", () => {
    const { root } = initializeRepo();
    expect(() =>
      validateTaskContract(
        contract(root, {
          working_branch: "arbitrary-branch",
        }),
        root,
      ),
    ).toThrowError(/must start with/);
    expect(() =>
      validateTaskContract(
        contract(root, {
          worktree_path: "relative/worktree",
        }),
        root,
      ),
    ).toThrowError(/absolute path/);
  });
});

describe("agent:start", () => {
  it("creates a worktree, branch, active contract, and state record", () => {
    const { root } = initializeRepo();
    const task = contract(root);
    addReadyTask(root, task);
    const result = startTask(root, task.id);
    expect(result.reused).toBe(false);
    expect(git(task.worktree_path, "branch", "--show-current")).toBe(task.working_branch);
    expect(existsSync(join(task.worktree_path, ".agent", "state", `${task.id}.json`))).toBe(true);
    expect(readTaskFile(join(task.worktree_path, ".agent", "tasks", "active", `${task.id}.yaml`), task.worktree_path).status).toBe(
      "active",
    );
  });

  it("detects and safely reuses an existing matching worktree", () => {
    const { root } = initializeRepo();
    const task = contract(root);
    addReadyTask(root, task);
    startTask(root, task.id);
    expect(startTask(root, task.id).reused).toBe(true);
  });

  it("adopts an existing Cursor-created local branch that is not checked out", () => {
    const { root } = initializeRepo();
    const task = contract(root);
    addReadyTask(root, task);
    git(root, "branch", task.working_branch, "origin/develop");
    expect(startTask(root, task.id).branch).toBe(task.working_branch);
  });

  it("refuses when the branch is checked out in a different worktree", () => {
    const { root, scratch } = initializeRepo();
    const task = contract(root);
    addReadyTask(root, task);
    const other = join(scratch, "unrelated-worktree");
    git(root, "worktree", "add", "-b", task.working_branch, other, "origin/develop");
    expect(() => startTask(root, task.id)).toThrowError(/already in use/);
  });
});

describe("agent:check policy", () => {
  it("accepts allowed paths", () => {
    const { root } = initializeRepo();
    const active = createActiveBranch(root);
    write(join(root, "src", "components", "allowed.ts"), "export const allowed = true;\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "allowed change");
    expect(checkTask(root, active.task).ok).toBe(true);
  });

  it("rejects unauthorized paths", () => {
    const { root } = initializeRepo();
    const active = createActiveBranch(root);
    write(join(root, "README.md"), "unauthorized\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "unauthorized change");
    expect(checkTask(root, active.task).issues.some((issue) => issue.code === "UNAUTHORIZED_PATH")).toBe(true);
  });

  it("rejects protected paths even when broadly allowed", () => {
    const { root } = initializeRepo();
    const active = createActiveBranch(root, contract(root, { allowed_paths: ["**"] }));
    write(join(root, "prisma", "schema.prisma"), "datasource db {}\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "protected change");
    expect(checkTask(root, active.task).issues.some((issue) => issue.code === "PROTECTED_PATH")).toBe(true);
  });

  it("rejects deletion of a protected path", () => {
    const { root } = initializeRepo();
    write(join(root, "prisma", "protected.txt"), "protected\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "protected base file");
    git(root, "push", "origin", "develop");
    const active = createActiveBranch(root, contract(root, { allowed_paths: ["**"] }));
    rmSync(join(root, "prisma", "protected.txt"));
    git(root, "add", ".");
    git(root, "commit", "-m", "delete protected file");
    expect(checkTask(root, active.task).issues.some((issue) => issue.code === "PROTECTED_PATH")).toBe(true);
  });

  it("rejects committed secret files", () => {
    const { root } = initializeRepo();
    const active = createActiveBranch(root, contract(root, { allowed_paths: ["**"] }));
    write(join(root, ".env.local"), "SAFE_TEST_VALUE=placeholder\n");
    git(root, "add", "-f", ".env.local");
    git(root, "commit", "-m", "secret file fixture");
    expect(checkTask(root, active.task).issues.some((issue) => issue.code === "SECRET_FILE")).toBe(true);
  });

  it("detects unresolved merge markers", () => {
    const { root } = initializeRepo();
    const active = createActiveBranch(root);
    write(join(root, "src", "components", "conflict.ts"), "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> branch\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "conflict marker fixture");
    expect(checkTask(root, active.task).issues.some((issue) => issue.code === "MERGE_MARKER")).toBe(true);
  });

  it("detects a dirty worktree", () => {
    const { root } = initializeRepo();
    const active = createActiveBranch(root);
    write(join(root, "src", "components", "dirty.ts"), "export const dirty = true;\n");
    expect(checkTask(root, active.task).issues.some((issue) => issue.code === "DIRTY_WORKTREE")).toBe(true);
  });
});

describe("validation and evidence", () => {
  it("normalizes carriage-return progress output before writing evidence", () => {
    expect(sanitizeOutput("step one  \r\nstep two\rprogress  ")).toBe("step one\nstep twoprogress");
  });

  it("refuses concurrent mutating actions for the same task", () => {
    const { root } = initializeRepo();
    const active = createActiveBranch(root);
    const release = acquireTaskLock(root, active.task.id, "test-holder");
    try {
      expect(() => finishTask(root, active.task.id)).toThrowError(/locked by test-holder/);
    } finally {
      release();
    }
  });

  it("executes validation commands and captures a successful exit code", () => {
    const { root } = initializeRepo();
    const result = runValidationCommand("node -e \"console.log('ok')\"", root);
    expect(result).toMatchObject({ exit_code: 0, passed: true });
    expect(result.stdout_summary).toContain("ok");
  });

  it("captures the exact failing exit code", () => {
    const { root } = initializeRepo();
    expect(runValidationCommand("node -e \"process.exit(7)\"", root)).toMatchObject({ exit_code: 7, passed: false });
  });

  it("generates a completion record with actual hashes and command evidence", () => {
    const { root } = initializeRepo();
    const active = createActiveBranch(root);
    const result = finishTask(root, active.task.id);
    const report = readFileSync(result.report, "utf8");
    expect(result.result.ok).toBe(true);
    expect(report).toContain(`- Final commit: ${git(root, "rev-parse", "HEAD")}`);
    expect(report).toContain("- Exit code: 0");
    expect(existsSync(join(root, ".agent", "completed", `${active.task.id}.yaml`))).toBe(true);
  });

  it("keeps a blocked task contract active while recording failure evidence", () => {
    const { root } = initializeRepo();
    const active = createActiveBranch(
      root,
      contract(root, { validation: ["node -e \"process.exit(9)\""] }),
    );
    const result = finishTask(root, active.task.id);
    expect(result.result.ok).toBe(false);
    expect(readTaskFile(active.file, root).status).toBe("blocked");
    expect(readFileSync(result.report, "utf8")).toContain("- Exit code: 9");
  });

  it("generates a review record and full diff artifact", () => {
    const { root } = initializeRepo();
    const active = createActiveBranch(root);
    const result = reviewTask(root, active.task.id, false);
    expect(existsSync(result.report)).toBe(true);
    expect(existsSync(result.diff)).toBe(true);
    expect(readFileSync(result.report, "utf8")).toContain("NOT MERGE READY");
    expect(readFileSync(result.diff, "utf8").split("\n").some((line) => /[ \t]$/.test(line))).toBe(false);
  });

  it("emits parseable JSON through the CLI", () => {
    const { root } = initializeRepo();
    const task = contract(root, { status: "active", worktree_path: root });
    const file = join(root, ".agent", "tasks", "active", `${task.id}.yaml`);
    write(file, stringify(task));
    const cli = resolve(import.meta.dirname, "cli.ts");
    const tsx = resolve(import.meta.dirname, "..", "..", "node_modules", ".bin", "tsx");
    const result = spawnSync(tsx, [cli, "status", "--json"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });
});

describe("agent:cleanup and reconciliation", () => {
  it("safely removes a clean, pushed, completed, merged worktree", () => {
    const { root } = initializeRepo();
    const task = contract(root);
    addReadyTask(root, task);
    startTask(root, task.id);
    git(task.worktree_path, "add", ".");
    git(task.worktree_path, "commit", "-m", "start metadata");
    finishTask(task.worktree_path, task.id);
    git(task.worktree_path, "add", ".");
    git(task.worktree_path, "commit", "-m", "finish evidence");
    git(task.worktree_path, "push", "-u", "origin", task.working_branch);
    git(root, "merge", "--no-ff", task.working_branch, "-m", "merge test task");
    git(root, "push", "origin", "develop");
    const result = cleanupTask(root, task.id);
    expect(result.removed_worktree).toBe(true);
    expect(existsSync(task.worktree_path)).toBe(false);
  });

  it("removes only the declared task worktree and preserves unrelated dirty worktrees", () => {
    const { root, scratch } = initializeRepo();
    const task = contract(root);
    addReadyTask(root, task);
    startTask(root, task.id);

    const unrelated = join(scratch, "unrelated-dirty-worktree");
    git(root, "worktree", "add", "-b", "feature/unrelated-dirty", unrelated, "origin/develop");
    write(join(unrelated, "src", "components", "unrelated-dirty.ts"), "export const protectedWork = true;\n");

    git(task.worktree_path, "add", ".");
    git(task.worktree_path, "commit", "-m", "start metadata");
    finishTask(task.worktree_path, task.id);
    git(task.worktree_path, "add", ".");
    git(task.worktree_path, "commit", "-m", "finish evidence");
    git(task.worktree_path, "push", "-u", "origin", task.working_branch);
    git(root, "merge", "--no-ff", task.working_branch, "-m", "merge test task");
    git(root, "push", "origin", "develop");

    cleanupTask(root, task.id);
    expect(existsSync(task.worktree_path)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
    expect(git(unrelated, "status", "--porcelain")).toContain("unrelated-dirty.ts");
  });

  it("refuses to clean an unmerged task", () => {
    const { root } = initializeRepo();
    const task = contract(root);
    addReadyTask(root, task);
    startTask(root, task.id);
    git(task.worktree_path, "add", ".");
    git(task.worktree_path, "commit", "-m", "start metadata");
    git(task.worktree_path, "push", "-u", "origin", task.working_branch);
    expect(() => cleanupTask(root, task.id)).toThrowError(/unmerged branch/);
  });

  it("refuses to destroy dirty work", () => {
    const { root } = initializeRepo();
    const task = contract(root);
    addReadyTask(root, task);
    startTask(root, task.id);
    write(join(task.worktree_path, "src", "components", "dirty.ts"), "dirty\n");
    expect(() => cleanupTask(root, task.id)).toThrowError(/dirty worktree/);
  });

  it("flags stale or missing declared worktrees", () => {
    const { root } = initializeRepo();
    const task = contract(root, { status: "active" });
    write(join(root, ".agent", "tasks", "active", `${task.id}.yaml`), stringify(task));
    const [entry] = taskStatus(root);
    expect(["missing", "stale"]).toContain(entry.reconciliation);
  });
});

describe("native worktree workflow", () => {
  it("creates a registered worktree without vendor-specific environment metadata", () => {
    const { root } = initializeRepo();
    const task = contract(root);
    addReadyTask(root, task);
    const result = startTask(root, task.id);
    const registered = git(root, "worktree", "list", "--porcelain");
    const resolvedWorktree = git(task.worktree_path, "rev-parse", "--show-toplevel");
    expect(result.worktree).toBe(task.worktree_path);
    expect(existsSync(task.worktree_path)).toBe(true);
    expect(registered).toContain(`worktree ${resolvedWorktree}`);
    expect(registered).toContain(`branch refs/heads/${task.working_branch}`);
  });
});
