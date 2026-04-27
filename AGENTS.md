# Agent Guidelines

## File Organization

- Keep files focused and small. Split by area of responsibility — feature, module, or domain concept.
- If a file is getting long, that's a signal it's doing too much and should be broken up.
- Before creating a new file or function, check if one already exists for that purpose.

## Comments

- All function declarations must have a comment explaining what it does, its parameters, and return value.
- Add inline comments for non-obvious logic — complex conditionals, async flows, business rules. Explain *why*, not just *what*.
- Never leave commented-out code. If something is removed, delete it — Git has the history.

## Agent Behavior

- Do not install packages without confirming with the user first.
- Always use `pnpm` instead of `npm`.
- When implementing a feature, stay in scope. Do not refactor unrelated code in the same task.