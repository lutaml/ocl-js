# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`@lutaml/ocl` — a dependency-free TypeScript engine for a subset of OCL
(Object Constraint Language) expressions. Extracted from the OIML SMART
platform. The library parses and evaluates expressions like
`ocl{ [load] * 0.5 }` and `if $context.accuracy_class = 'I' then ... endif`
against a measurement/context payload.

The package ships zero runtime dependencies and produces dual ESM + CJS
bundles plus a generated `.d.ts`.

## Commands

```sh
npm run clean           # remove dist/
npm run build           # vite build → dist/ocl.js (ESM), dist/ocl.cjs (CJS), dist/index.d.ts
npm test                # vitest run (single-shot)
npm run test:watch      # vitest in watch mode
npm run prepublishOnly   # clean + build + test (runs automatically before npm publish)
```

Run a single test file:

```sh
npx vitest run tests/ocl-engine.test.ts
```

Run tests matching a name pattern:

```sh
npx vitest run -t 'tokenizes $context'
```

There is no lint script — `strict` TypeScript (`tsconfig.json`) is the
primary static check. Re-run `npm run build` after touching source to catch
type errors; the test runner only transpiles via esbuild and will not fail
on type errors.

## Architecture

The engine is a four-stage pipeline. Each stage lives in its own file under
`src/`, and each stage is independently importable from the public API in
`src/index.ts`:

```
expression string
   │
   ▼
lexer.ts        tokenize() / stripOclPrefix()
   │            Token[] — operator/keyword/identifier/ref/context-var tokens
   ▼
parser.ts       OclParser / parseOcl()
   │            ASTNode — recursive-descent, explicit precedence chain
   ▼
┌─────────────────────────────┐
│ evaluator.ts                │ validator.ts
│ OclEvaluator.evaluate(ast)  │ validateOclExpression(expr)
│ runs against an             │ static checks: unresolved ids,
│ EvaluationContext           │ unknown fns, type mismatches,
│                             │ circular deps (no execution)
└─────────────────────────────┘
```

### Pipeline contracts

- **Lexer** (`src/lexer.ts`): single-pass scanner. Note the non-obvious
  behaviour in `tokenize`: `[ident]` or `[form:id]` is collapsed into a
  single `MEASUREMENT_REF` token at scan time — only brackets that *fail*
  the identifier regex fall through to `LBRACKET`/`RBRACKET` for index
  access. `stripOclPrefix` peels an outer `ocl{ … }` wrapper if present;
  without that wrapper, the string is treated as prose and returned
  unchanged.
- **Parser** (`src/parser.ts`): recursive descent with the precedence chain
  `implies → xor → or → and → not → comparison → in → addition →
  multiplication → unary → power → postfix → primary` (see the comment
  block at `parser.ts:117`). Collection ops (`->collect`, `->select`,
  `->forAll`, `->size`, …) are recognised in `parsePostfix` via the
  `COLLECTION_OPS_WITH_LAMBDA` / `COLLECTION_OPS_NO_LAMBDA` sets defined at
  the top of the file — extend those sets, not the postfix logic, when
  adding a new collection op. Lambdas accept either `|` or `=>` as the
  separator.
- **Evaluator** (`src/evaluator.ts`): a single `evaluate(node)` switch over
  `node.kind`. Resolves `[ref]` against `ctx.measurements` (and
  `ctx.crossForm[formId]`), resolves `$context`, `$index`, `$self`,
  `$root`, `$parent`, `$prev`, `$form` from `ctx.contextVars`, and
  implements builtin functions (`abs`, `round`, `lookup`, `lookup_mpe`,
  `prev`, …). `OclValue` is intentionally `any` — OCL is dynamically typed
  at evaluation time.
- **Validator** (`src/validator.ts`): walks the AST without evaluating.
  `BUILTIN_FUNCTIONS` and `CONTEXT_VAR_NAMES` sets near the top define the
  known-good identifier universe — update these when adding builtins. The
  validator accepts `knownIdentifiers` / `knownContextFields` from the
  caller for project-specific symbol tables. Use `detectCircularDependencies`
  before evaluating any expression that references other expressions.

### Build configuration

- `vite.config.ts` builds the library: entry `src/index.ts`, outputting both
  ESM (`dist/ocl.js`) and CJS (`dist/ocl.cjs`). `vite-plugin-dts` emits
  `dist/index.d.ts`. The `package.json` `exports` field maps `.` to both
  formats with the `types` condition first.
- `vitest.config.ts` aliases `@lutaml/ocl` → `src/index.ts` so tests can
  import the package name while executing against source.
- `tsconfig.json` targets ES2022 with `strict: true`. `tests/` is excluded
  from compilation but type-checks via vitest.

### Testing

All tests live in a single file: `tests/ocl-engine.test.ts`. The file is
organised into `describe` blocks per pipeline stage (Lexer, Parser,
Evaluator, Validator) and is the canonical reference for supported syntax —
consult it before extending grammar or builtins.
