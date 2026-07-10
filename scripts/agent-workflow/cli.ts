#!/usr/bin/env node

import { relative } from "node:path";

import {
  WorkflowError,
  checkTask,
  ciCheck,
  cleanupTask,
  findRepoRoot,
  finishTask,
  resolveTask,
  reviewTask,
  startTask,
  taskStatus,
} from "./core";

type Flags = {
  json: boolean;
  runValidation: boolean;
  all: boolean;
  dangerous: boolean;
  deleteBranch: boolean;
  approve: boolean;
  positionals: string[];
};

function parseFlags(values: string[]): Flags {
  const flags: Flags = {
    json: false,
    runValidation: false,
    all: false,
    dangerous: false,
    deleteBranch: false,
    approve: false,
    positionals: [],
  };
  for (const value of values) {
    if (value === "--json") flags.json = true;
    else if (value === "--run-validation") flags.runValidation = true;
    else if (value === "--all") flags.all = true;
    else if (value === "--dangerous") flags.dangerous = true;
    else if (value === "--delete-branch") flags.deleteBranch = true;
    else if (value === "--approve") flags.approve = true;
    else flags.positionals.push(value);
  }
  return flags;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printCheck(result: ReturnType<typeof checkTask>): void {
  console.log(`${result.ok ? "PASS" : "FAIL"}: task ${result.task_id}`);
  console.log(`Branch: ${result.branch}`);
  console.log(`Worktree: ${result.worktree}`);
  console.log(`Base: ${result.base_ref} (${result.base_commit})`);
  console.log(`Merge base: ${result.merge_base}`);
  console.log(`Changed files (${result.changed_files.length}):`);
  for (const file of result.changed_files) console.log(`  ${file}`);
  if (result.issues.length > 0) {
    console.log(`Issues (${result.issues.length}):`);
    for (const issue of result.issues) {
      console.log(`  ${issue.severity} ${issue.code}${issue.file ? ` ${issue.file}${issue.line ? `:${issue.line}` : ""}` : ""}: ${issue.message}`);
    }
  }
  for (const validation of result.validation) {
    console.log(`Validation ${validation.passed ? "PASS" : "FAIL"} (${validation.exit_code}): ${validation.command}`);
  }
}

function usage(): never {
  console.error(
    "Usage: agent-workflow <start|status|check|finish|review|cleanup|ci> [task-id-or-file] [--json]",
  );
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);
if (!command) usage();
const flags = parseFlags(args);

try {
  const repoRoot = findRepoRoot();
  if (command === "start") {
    const taskArg = flags.positionals[0];
    if (!taskArg) usage();
    const result = startTask(repoRoot, taskArg);
    if (flags.json) printJson(result);
    else {
      const verb = result.adopted ? "Adopted" : result.reused ? "Reused" : "Created";
      console.log(`${verb} task worktree: ${result.worktree}`);
      console.log(`Mode: ${result.mode}`);
      console.log(`Branch: ${result.branch}`);
      console.log(`Base: ${result.base_ref} (${result.base_commit})`);
      console.log(`Task: ${result.task_file}`);
      console.log("Next instructions:");
      for (const instruction of result.next_instructions) console.log(`  ${instruction}`);
    }
  } else if (command === "status") {
    const result = taskStatus(repoRoot, flags.all);
    if (flags.json) printJson(result);
    else if (result.length === 0) console.log("No active task contracts found.");
    else {
      for (const task of result) {
        console.log(`${task.id}: ${task.status} / ${task.risk} / ${task.reconciliation}`);
        console.log(`  ${task.owner} -> ${task.reviewer}`);
        console.log(`  ${task.branch}`);
        console.log(`  ${task.worktree}`);
        console.log(`  modified: ${task.modified === null ? "unknown" : task.modified}`);
        for (const detail of task.details) console.log(`  warning: ${detail}`);
      }
    }
  } else if (command === "check") {
    const taskArg = flags.positionals[0];
    if (!taskArg) usage();
    const resolved = resolveTask(repoRoot, taskArg);
    const result = checkTask(repoRoot, resolved.task, {
      taskFile: resolved.file,
      runValidation: flags.runValidation,
      requireClean: true,
    });
    if (flags.json) printJson(result);
    else printCheck(result);
    if (!result.ok) process.exitCode = 1;
  } else if (command === "finish") {
    const taskArg = flags.positionals[0];
    if (!taskArg) usage();
    const result = finishTask(repoRoot, taskArg);
    const output = { report: relative(repoRoot, result.report), ...result.result };
    if (flags.json) printJson(output);
    else {
      printCheck(result.result);
      console.log(`Completion record: ${relative(repoRoot, result.report)}`);
    }
    if (!result.result.ok) process.exitCode = 1;
  } else if (command === "review") {
    const taskArg = flags.positionals[0];
    if (!taskArg) usage();
    const result = reviewTask(repoRoot, taskArg, flags.approve);
    const output = {
      report: relative(repoRoot, result.report),
      diff: relative(repoRoot, result.diff),
      approved: flags.approve && result.result.ok,
      ...result.result,
    };
    if (flags.json) printJson(output);
    else {
      printCheck(result.result);
      console.log(`Review record: ${relative(repoRoot, result.report)}`);
      console.log(`Full diff: ${relative(repoRoot, result.diff)}`);
      if (!flags.approve) console.log("Semantic reviewer attestation still required; rerun with --approve only after review.");
    }
    if (!result.result.ok || !flags.approve) process.exitCode = 1;
  } else if (command === "cleanup") {
    const taskArg = flags.positionals[0];
    if (!taskArg) usage();
    const result = cleanupTask(repoRoot, taskArg, {
      dangerous: flags.dangerous,
      deleteBranch: flags.deleteBranch,
    });
    if (flags.json) printJson(result);
    else {
      console.log(`Removed worktree: ${result.worktree}`);
      console.log(`Pruned stale metadata: ${result.pruned}`);
      console.log(`Deleted branch: ${result.deleted_branch}`);
    }
  } else if (command === "ci") {
    const result = ciCheck(repoRoot, process.env.GITHUB_BASE_REF || flags.positionals[0]);
    if (flags.json) printJson(result);
    else {
      console.log(result.message);
      if (result.result) printCheck(result.result);
    }
    if (result.result && !result.result.ok) process.exitCode = 1;
  } else {
    usage();
  }
} catch (error) {
  const workflowError = error instanceof WorkflowError ? error : new WorkflowError(String(error), "UNEXPECTED_ERROR");
  if (flags.json) printJson({ ok: false, error: { code: workflowError.code, message: workflowError.message } });
  else console.error(`${workflowError.code}: ${workflowError.message}`);
  process.exitCode = 1;
}
