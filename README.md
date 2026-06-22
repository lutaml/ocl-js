# @metanorma/ocl

OCL (Object Constraint Language) expression engine for TypeScript.

A standalone library extracted from the OIML SMART platform. Provides a
subset of OCL suitable for embedded evaluation in measurement/validation
workflows:

- Lexer with support for arithmetic, comparison, logical, and collection
  operators; `[reference]` syntax; `$context` variables; `->` collection
  navigation; `=>` and `|` lambda separators; `ocl{ ... }` prefix handling.
- Recursive-descent parser producing a typed AST.
- Evaluator that resolves references, context variables, lambdas,
  quantifiers, conditionals, and built-in functions (`abs`, `round`,
  `floor`, `ceil`, `sqrt`, `pow`, `lookup`, `lookup_mpe`, `prev`, ...).
- Static validator that surfaces unresolved identifiers, unknown functions,
  type mismatches, and circular dependencies without executing the
  expression.

## Installation

```sh
npm install @metanorma/ocl
```

## Usage

```typescript
import { parseOcl, OclEvaluator, type EvaluationContext } from '@metanorma/ocl'

const ast = parseOcl('ocl{ [load] * 0.5 }')
const ctx: EvaluationContext = { measurements: { load: 100 } }
const result = new OclEvaluator(ctx).evaluate(ast)
// result === 50
```

## License

BSD-3-Clause. See [LICENSE](./LICENSE).
