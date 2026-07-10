# Architecture decision records

Use an ADR when a change creates or revises a durable architectural boundary, data ownership rule, external integration strategy, security posture, or operating constraint.

Name records `ADR-0001-short-description.md` with the next available four-digit number. Keep an ADR focused on one decision and link the task contract and implementation files.

```markdown
# ADR-0001: Short description

- Status: proposed | accepted | superseded | rejected
- Date: YYYY-MM-DD

## Context

What problem, constraint, and verified repository state require a decision?

## Decision

What will the system do, and where is the boundary enforced?

## Alternatives considered

- Alternative and why it was not selected.

## Consequences

- Positive and negative operational consequences.

## Risks

- Failure modes and mitigations.

## Relevant files

- `path/to/file`

## Follow-up work

- Explicit deferred tasks.
```

Never use an ADR to retroactively justify unsafe implementation or to override an invariant without explicit owner/security review.
