---
name: project-map
description: Install, configure, and run the first build of the project-map CLI in the current repo. Generates a deterministic PROJECT_MAP.md (AST-derived architectural map) and optionally wires Claude Code + git hooks. Use when onboarding a repo to project-map or when refreshing a stale PROJECT_MAP.md.
---

# /project-map

Guided onboarding for the `project-map` CLI. Follow the steps strictly in order.
At every decision point, ask the user via AskUserQuestion rather than guessing.

## 1. Preflight

Run in parallel:

- `node --version` — must be >= 22. If lower, stop and tell the user to upgrade.
- `git rev-parse --show-toplevel` — note the repo root. If it fails, warn that
  revision metadata will be empty, but continue.
- Check whether `PROJECT_MAP.md` already exists at the repo root. If it does,
  offer to skip straight to step 6 (rebuild) and do nothing else.

## 2. Detect language & framework

Read only manifest files — do not load source code:

- `package.json` + `tsconfig.json` present → `typescript`. Scan `dependencies`
  and `devDependencies` for `express` / `fastify` → set framework.
- `package.json` without `tsconfig.json` → `javascript`; same framework scan.
- `pyproject.toml`, `requirements.txt`, or `setup.py` → `python`. Scan for
  `aiohttp`, `fastapi`, `flask`, `sqlalchemy`, `alembic`.
- `go.mod` → `go`. Scan for `gin`, `chi`, `echo`.
- `pom.xml` or `build.gradle` referencing `spring-boot` → `java` + `spring`.
- `build.gradle.kts` with the Kotlin plugin → `kotlin`.

Present what you found via AskUserQuestion with three options:
"accept detected", "override language/framework", "skip framework".

## 3. Install the CLI

Detect the package manager by lockfile and run exactly one command. Note the
npm package is `project-map-cli`; the binary it exposes is `project-map`.

- `pnpm-lock.yaml` → `pnpm add -D project-map-cli`
- `yarn.lock` → `yarn add -D project-map-cli`
- `package-lock.json` → `npm install --save-dev project-map-cli`
- No `package.json` at all → AskUserQuestion: create a local dev-dep
  (`npm init -y` then `npm install --save-dev project-map-cli`) or install
  globally (`npm install -g project-map-cli`).

If install fails on tree-sitter grammar compilation, tell the user explicitly
that a C/C++ toolchain is required — Xcode Command Line Tools on macOS or
`build-essential` on Linux — then stop and ask them to install it.

## 4. Scaffold config

Run:

```
npx project-map init --lang <detected-language> [--framework <detected-framework>]
```

If `.project-map.yaml` (or any `.project-map.*` variant) already exists, ask
whether to re-scaffold with `--force` or keep the existing file.

## 5. Review config

Read the generated `.project-map.yaml`, show it to the user, and ask via
AskUserQuestion whether they want to edit anything before the first build:
`exclude` globs, `sections` list, framework-specific fields
(`endpoints.framework`, `storage.base_class`, `interactions.dir`).

If they edit, re-show the file and confirm once more before proceeding.

## 6. First build

Run:

```
npx project-map build --json
```

Report the paths that were written:

- `PROJECT_MAP.md` at the configured output path (default: repo root)
- `project-map.json` (only if the config keeps it enabled)

Surface any warnings from the CLI verbatim.

## 7. Offer extra hooks

AskUserQuestion **multiSelect** with these options:

- Install git `pre-push` hook — `npx project-map install-git-hook --type pre-push`
- Install git `pre-commit` hook — `npx project-map install-git-hook --type pre-commit`
- Skip

The Claude Code hook and this skill are already installed — that is how
`/project-map` got into the user's slash menu — so do not re-offer them here.

## 8. Summary

Print a short wrap-up:

- Paths of every file that was created or modified.
- How to refresh the map: `npx project-map build`.
- How to gate CI: `npx project-map build --check` (exits non-zero if the
  committed map is stale).
- A pointer to `.project-map.yaml` for further tuning.
