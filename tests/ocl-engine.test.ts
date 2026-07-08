import { describe, it, expect } from 'vitest'
import { tokenize, stripOclPrefix } from '@lutaml/ocl'
import { OclParser, parseOcl } from '@lutaml/ocl'
import { OclEvaluator, type EvaluationContext, type ContextVars } from '@lutaml/ocl'
import { validateOclExpression, detectCircularDependencies } from '@lutaml/ocl'

function evalExpr(expr: string, ctx: Partial<EvaluationContext> = {}): unknown {
  const stripped = stripOclPrefix(expr)
  const tokens = tokenize(stripped)
  const ast = new OclParser(tokens).parse()
  return new OclEvaluator({
    measurements: {},
    ...ctx,
  } as EvaluationContext).evaluate(ast)
}

// ═══════════════════════════════════════════════════════════
// 1. Lexer
// ═══════════════════════════════════════════════════════════

describe('OCL Lexer', () => {
  describe('context variables', () => {
    it('tokenizes $context as CONTEXT_VAR', () => {
      const tokens = tokenize('$context.p_LC')
      expect(tokens[0].type).toBe('CONTEXT_VAR')
      expect(tokens[0].value).toBe('$context')
      expect(tokens[1].type).toBe('DOT')
      expect(tokens[2].type).toBe('IDENTIFIER')
      expect(tokens[2].value).toBe('p_LC')
    })

    it('tokenizes $index as CONTEXT_VAR', () => {
      const tokens = tokenize('$index')
      expect(tokens[0].type).toBe('CONTEXT_VAR')
      expect(tokens[0].value).toBe('$index')
    })

    it('tokenizes $self as CONTEXT_VAR', () => {
      const tokens = tokenize('$self')
      expect(tokens[0].type).toBe('CONTEXT_VAR')
      expect(tokens[0].value).toBe('$self')
    })

    it('tokenizes $root, $prev, $form, $parent as CONTEXT_VAR', () => {
      for (const name of ['$root', '$prev', '$form', '$parent']) {
        const tokens = tokenize(name)
        expect(tokens[0].type).toBe('CONTEXT_VAR')
        expect(tokens[0].value).toBe(name)
      }
    })
  })

  describe('lambda tokens', () => {
    it('tokenizes pipe |', () => {
      const tokens = tokenize('x | x + 1')
      expect(tokens[1].type).toBe('PIPE')
    })

    it('tokenizes fat arrow =>', () => {
      const tokens = tokenize('x => x + 1')
      expect(tokens[1].type).toBe('FAT_ARROW')
    })
  })

  describe('!= operator', () => {
    it('tokenizes != as NEQ', () => {
      const tokens = tokenize('a != b')
      expect(tokens[1].type).toBe('NEQ')
      expect(tokens[1].value).toBe('!=')
    })
  })

  describe('ocl{} prefix stripping', () => {
    it('strips ocl{...} prefix', () => {
      expect(stripOclPrefix('ocl{a + b}')).toBe('a + b')
    })

    it('strips ocl{...} with surrounding whitespace', () => {
      expect(stripOclPrefix('  ocl{a + b}  ')).toBe('a + b')
    })

    it('returns input unchanged when no ocl{ prefix', () => {
      expect(stripOclPrefix('a + b')).toBe('a + b')
    })

    it('handles nested braces in expression', () => {
      expect(stripOclPrefix("ocl{if x = 1 then 'a' else 'b' endif}")).toBe(
        "if x = 1 then 'a' else 'b' endif",
      )
    })
  })
})

// ═══════════════════════════════════════════════════════════
// 2. Parser
// ═══════════════════════════════════════════════════════════

describe('OCL Parser', () => {
  describe('context variables', () => {
    it('parses $context.p_LC as ContextVarExpr with path', () => {
      const ast = parseOcl('$context.p_LC')
      expect(ast.kind).toBe('context_var')
      if (ast.kind === 'context_var') {
        expect(ast.name).toBe('$context')
        expect(ast.path).toEqual(['p_LC'])
      }
    })

    it('parses $context.accuracy_class as ContextVarExpr', () => {
      const ast = parseOcl('$context.accuracy_class')
      expect(ast.kind).toBe('context_var')
      if (ast.kind === 'context_var') {
        expect(ast.name).toBe('$context')
        expect(ast.path).toEqual(['accuracy_class'])
      }
    })

    it('parses $index as ContextVarExpr without path', () => {
      const ast = parseOcl('$index')
      expect(ast.kind).toBe('context_var')
      if (ast.kind === 'context_var') {
        expect(ast.name).toBe('$index')
        expect(ast.path).toEqual([])
      }
    })

    it('parses $root.forms as ContextVarExpr with path', () => {
      const ast = parseOcl('$root.forms')
      expect(ast.kind).toBe('context_var')
      if (ast.kind === 'context_var') {
        expect(ast.name).toBe('$root')
        expect(ast.path).toEqual(['forms'])
      }
    })

    it('parses $form.pass_fail.overall as ContextVarExpr with deep path', () => {
      const ast = parseOcl('$form.pass_fail.overall')
      expect(ast.kind).toBe('context_var')
      if (ast.kind === 'context_var') {
        expect(ast.name).toBe('$form')
        expect(ast.path).toEqual(['pass_fail', 'overall'])
      }
    })
  })

  describe('lambda expressions', () => {
    it('parses pipe lambda: r | r.value', () => {
      const ast = parseOcl('items->collect(r | r.value)')
      expect(ast.kind).toBe('collection')
      if (ast.kind === 'collection') {
        expect(ast.operation).toBe('collect')
        expect(ast.lambda).toBeDefined()
        expect(ast.lambda!.paramName).toBe('r')
        expect(ast.lambda!.body.kind).toBe('property')
      }
    })

    it('parses fat arrow lambda: r => r.value', () => {
      const ast = parseOcl('items->collect(r => r.value)')
      expect(ast.kind).toBe('collection')
      if (ast.kind === 'collection') {
        expect(ast.operation).toBe('collect')
        expect(ast.lambda!.paramName).toBe('r')
      }
    })

    it('parses lambda with complex body', () => {
      const ast = parseOcl("items->select(r | r.time_minutes = 30)")
      expect(ast.kind).toBe('collection')
      if (ast.kind === 'collection') {
        expect(ast.operation).toBe('select')
        expect(ast.lambda!.paramName).toBe('r')
      }
    })
  })

  describe('collection operations', () => {
    it('parses ->reject with lambda', () => {
      const ast = parseOcl('items->reject(x | x.flagged)')
      expect(ast.kind).toBe('collection')
      if (ast.kind === 'collection') {
        expect(ast.operation).toBe('reject')
        expect(ast.lambda!.paramName).toBe('x')
      }
    })

    it('parses ->any with lambda', () => {
      const ast = parseOcl('items->any(x | x.valid)')
      expect(ast.kind).toBe('collection')
      if (ast.kind === 'collection') {
        expect(ast.operation).toBe('any')
        expect(ast.lambda!.paramName).toBe('x')
      }
    })

    it('parses ->isEmpty without parens', () => {
      const ast = parseOcl('items->isEmpty')
      expect(ast.kind).toBe('collection')
      if (ast.kind === 'collection') {
        expect(ast.operation).toBe('isEmpty')
        expect(ast.lambda).toBeUndefined()
      }
    })

    it('parses ->notEmpty without parens', () => {
      const ast = parseOcl('items->notEmpty')
      expect(ast.kind).toBe('collection')
      if (ast.kind === 'collection') {
        expect(ast.operation).toBe('notEmpty')
      }
    })

    it('parses ->size without parens', () => {
      const ast = parseOcl('items->size')
      expect(ast.kind).toBe('collection')
      if (ast.kind === 'collection') {
        expect(ast.operation).toBe('size')
      }
    })
  })

  describe('index access', () => {
    it('parses expr[index] as IndexAccessExpr', () => {
      const ast = parseOcl('items[0]')
      expect(ast.kind).toBe('index_access')
      if (ast.kind === 'index_access') {
        expect(ast.object.kind).toBe('measurement_ref')
        expect(ast.index.kind).toBe('number')
      }
    })
  })

  describe('ocl{} prefix handling', () => {
    it('parseOcl strips ocl{} prefix', () => {
      const ast = parseOcl('ocl{a + b}')
      expect(ast.kind).toBe('binary')
      if (ast.kind === 'binary') {
        expect(ast.op).toBe('+')
      }
    })

    it('parseOcl works without prefix', () => {
      const ast = parseOcl('a + b')
      expect(ast.kind).toBe('binary')
    })
  })
})

// ═══════════════════════════════════════════════════════════
// 3. Evaluator
// ═══════════════════════════════════════════════════════════

describe('OCL Evaluator', () => {
  describe('context variables', () => {
    it('resolves $context.p_LC', () => {
      const result = evalExpr('$context.p_LC', {
        contextVars: { $context: { p_LC: 0.7 } },
      })
      expect(result).toBe(0.7)
    })

    it('resolves $context.accuracy_class', () => {
      const result = evalExpr('$context.accuracy_class', {
        contextVars: { $context: { accuracy_class: 'C' } },
      })
      expect(result).toBe('C')
    })

    it('resolves $index', () => {
      const result = evalExpr('$index', {
        contextVars: { $index: 3 },
      })
      expect(result).toBe(3)
    })

    it('resolves $self.form_id', () => {
      const result = evalExpr('$self.form_id', {
        contextVars: { $self: { form_id: 'creep-dr' } },
      })
      expect(result).toBe('creep-dr')
    })

    it('resolves $root.forms', () => {
      const result = evalExpr('$root.forms', {
        contextVars: { $root: { forms: { 'load-cell-info': {} } } },
      })
      expect(result).toEqual({ 'load-cell-info': {} })
    })

    it('resolves $form.pass_fail.overall', () => {
      const result = evalExpr('$form.pass_fail.overall', {
        contextVars: { $form: { pass_fail: { overall: 'PASS' } } },
      })
      expect(result).toBe('PASS')
    })

    it('resolves $prev.temperature from DATALIST iteration', () => {
      const result = evalExpr('$prev.temperature', {
        contextVars: { $prev: { temperature: 22.5 } },
      })
      expect(result).toBe(22.5)
    })

    it('returns null for unresolved context var path', () => {
      const result = evalExpr('$context.nonexistent', {
        contextVars: { $context: { p_LC: 0.7 } },
      })
      expect(result).toBeNull()
    })

    it('returns null for missing contextVars', () => {
      const result = evalExpr('$context.p_LC')
      expect(result).toBeNull()
    })

    it('uses $context in arithmetic', () => {
      const result = evalExpr('$context.conversion_factor_f * 2', {
        contextVars: { $context: { conversion_factor_f: 1.5 } },
      })
      expect(result).toBeCloseTo(3.0, 5)
    })
  })

  describe('lambda expressions in collection ops', () => {
    const readings = [
      { temperature: 20, change_v: 0.5 },
      { temperature: 22, change_v: 0.3 },
      { temperature: 25, change_v: 0.8 },
    ]

    it('->collect with pipe lambda', () => {
      const result = evalExpr('readings->collect(r | r.change_v)', {
        measurements: { readings },
      })
      expect(result).toEqual([0.5, 0.3, 0.8])
    })

    it('->collect with fat arrow lambda', () => {
      const result = evalExpr('readings->collect(r => r.temperature)', {
        measurements: { readings },
      })
      expect(result).toEqual([20, 22, 25])
    })

    it('->select with lambda', () => {
      const result = evalExpr('readings->select(r | r.temperature > 21)', {
        measurements: { readings },
      })
      expect(result).toEqual([
        { temperature: 22, change_v: 0.3 },
        { temperature: 25, change_v: 0.8 },
      ])
    })

    it('->reject with lambda', () => {
      const result = evalExpr('readings->reject(r | r.temperature > 21)', {
        measurements: { readings },
      })
      expect(result).toEqual([
        { temperature: 20, change_v: 0.5 },
      ])
    })

    it('->forAll with lambda', () => {
      const result = evalExpr('readings->forAll(r | r.change_v <= 1.0)', {
        measurements: { readings },
      })
      expect(result).toBe(true)
    })

    it('->forAll returns false when not all satisfy', () => {
      const result = evalExpr('readings->forAll(r | r.change_v < 0.5)', {
        measurements: { readings },
      })
      expect(result).toBe(false)
    })

    it('->exists with lambda', () => {
      const result = evalExpr('readings->exists(r | r.temperature = 25)', {
        measurements: { readings },
      })
      expect(result).toBe(true)
    })

    it('->exists returns false when none satisfy', () => {
      const result = evalExpr('readings->exists(r | r.temperature = 99)', {
        measurements: { readings },
      })
      expect(result).toBe(false)
    })

    it('->any with lambda (alias for exists)', () => {
      const result = evalExpr('readings->any(r | r.temperature = 25)', {
        measurements: { readings },
      })
      expect(result).toBe(true)
    })

    it('chained collection ops: collect then max', () => {
      const result = evalExpr('readings->collect(r | r.change_v)->max', {
        measurements: { readings },
      })
      expect(result).toBe(0.8)
    })

    it('chained: select then first', () => {
      const result = evalExpr("readings->select(r | r.temperature = 22)->first", {
        measurements: { readings },
      })
      expect(result).toEqual({ temperature: 22, change_v: 0.3 })
    })

    it('chained: select then first then property', () => {
      const result = evalExpr("readings->select(r | r.temperature = 22)->first.change_v", {
        measurements: { readings },
      })
      expect(result).toBe(0.3)
    })
  })

  describe('new collection operations', () => {
    const items = [3, 1, 4, 1, 5, 9, 2, 6]
    const empty: number[] = []

    it('->isEmpty returns true for empty array', () => {
      expect(evalExpr('arr->isEmpty', { measurements: { arr: empty } })).toBe(true)
    })

    it('->isEmpty returns false for non-empty array', () => {
      expect(evalExpr('arr->isEmpty', { measurements: { arr: items } })).toBe(false)
    })

    it('->notEmpty returns true for non-empty array', () => {
      expect(evalExpr('arr->notEmpty', { measurements: { arr: items } })).toBe(true)
    })

    it('->notEmpty returns false for empty array', () => {
      expect(evalExpr('arr->notEmpty', { measurements: { arr: empty } })).toBe(false)
    })

    it('->asSet removes duplicates', () => {
      const result = evalExpr('arr->asSet', { measurements: { arr: [1, 2, 2, 3, 3, 3] } })
      expect(result).toEqual([1, 2, 3])
    })

    it('->flatten flattens nested arrays', () => {
      const result = evalExpr('arr->flatten', {
        measurements: { arr: [[1, 2], [3, 4], [5]] },
      })
      expect(result).toEqual([1, 2, 3, 4, 5])
    })
  })

  describe('prev() builtin function', () => {
    it('returns the previous element field value', () => {
      const result = evalExpr("prev('temperature')", {
        contextVars: { $prev: { temperature: 22.5 } },
      })
      expect(result).toBe(22.5)
    })

    it('returns 0 when $prev is not set', () => {
      const result = evalExpr("prev('temperature')")
      expect(result).toBe(0)
    })

    it('returns 0 for unknown field', () => {
      const result = evalExpr("prev('unknown_field')", {
        contextVars: { $prev: { temperature: 22.5 } },
      })
      expect(result).toBe(0)
    })

    it('works in if/then/else with $index guard', () => {
      // if $index = 0 then 0 else change_v / abs(pressure - prev('pressure')) endif
      const result = evalExpr(
        "if $index = 0 then 0 else change_v / abs(pressure - prev('pressure')) endif",
        {
          measurements: { change_v: 0.5, pressure: 101.3 },
          contextVars: { $index: 1, $prev: { pressure: 101.0 } },
        },
      )
      expect(result).toBeCloseTo(1.667, 1)
    })

    it('returns 0 when $index is 0 (guard case)', () => {
      const result = evalExpr(
        "if $index = 0 then 0 else change_v / abs(pressure - prev('pressure')) endif",
        {
          measurements: { change_v: 0.5, pressure: 101.3 },
          contextVars: { $index: 0, $prev: {} },
        },
      )
      expect(result).toBe(0)
    })
  })

  describe('pow() function', () => {
    it('computes power', () => {
      expect(evalExpr('pow(2, 10)')).toBe(1024)
      expect(evalExpr('pow(3, 3)')).toBe(27)
    })

    it('computes square root via pow', () => {
      expect(evalExpr('pow(25, 0.5)')).toBeCloseTo(5, 10)
    })
  })

  describe('round() with decimal places', () => {
    it('rounds to 0 decimal places by default', () => {
      expect(evalExpr('round(3.7)')).toBe(4)
    })

    it('rounds to 2 decimal places', () => {
      expect(evalExpr('round(3.14159, 2)')).toBeCloseTo(3.14, 2)
    })

    it('rounds to 3 decimal places', () => {
      expect(evalExpr('round(3.14159, 3)')).toBeCloseTo(3.142, 3)
    })
  })

  describe('index access', () => {
    it('accesses array element by numeric index', () => {
      const result = evalExpr('items[1]', {
        measurements: { items: [10, 20, 30] },
      })
      expect(result).toBe(20)
    })

    it('accesses first element', () => {
      const result = evalExpr('items[0]', {
        measurements: { items: ['a', 'b', 'c'] },
      })
      expect(result).toBe('a')
    })

    it('returns null for out-of-bounds', () => {
      const result = evalExpr('items[99]', {
        measurements: { items: [1, 2, 3] },
      })
      expect(result).toBeNull()
    })

    it('accesses property after index', () => {
      const result = evalExpr('items[0].temperature', {
        measurements: { items: [{ temperature: 20 }, { temperature: 25 }] },
      })
      expect(result).toBe(20)
    })
  })

  describe('backward compatibility', () => {
    it('evaluates simple arithmetic', () => {
      expect(evalExpr('a + b', { measurements: { a: 3, b: 4 } })).toBe(7)
      expect(evalExpr('a - b', { measurements: { a: 10, b: 3 } })).toBe(7)
      expect(evalExpr('a * b', { measurements: { a: 6, b: 7 } })).toBe(42)
      expect(evalExpr('a / b', { measurements: { a: 15, b: 3 } })).toBe(5)
    })

    it('evaluates comparisons', () => {
      expect(evalExpr('a <= b', { measurements: { a: 3, b: 5 } })).toBe(true)
      expect(evalExpr('a > b', { measurements: { a: 3, b: 5 } })).toBe(false)
    })

    it('evaluates abs function', () => {
      expect(evalExpr('abs(a)', { measurements: { a: -5 } })).toBe(5)
    })

    it('evaluates if/then/else/endif', () => {
      const result = evalExpr('if a > 0 then a else -a endif', {
        measurements: { a: -3 },
      })
      expect(result).toBe(3)
    })

    it('evaluates [measurement_ref]', () => {
      expect(evalExpr('[some_field]', { measurements: { some_field: 42 } })).toBe(42)
    })

    it('evaluates let expression', () => {
      const result = evalExpr('let x = 10 in x * x')
      expect(result).toBe(100)
    })

    it('evaluates collection ops with legacy colon-separated lambda', () => {
      // Old style used colon — this is now pipe/fat-arrow, but
      // the measurement-engine still passes lambdas. Let's verify
      // the new pipe style works.
      const result = evalExpr('items->collect(x | x * 2)', {
        measurements: { items: [1, 2, 3] },
      })
      expect(result).toEqual([2, 4, 6])
    })

    it('evaluates ->sum on numeric collection', () => {
      expect(evalExpr('items->sum', { measurements: { items: [1, 2, 3, 4] } })).toBe(10)
    })

    it('evaluates ->average on numeric collection', () => {
      expect(evalExpr('items->average', { measurements: { items: [2, 4, 6] } })).toBeCloseTo(4, 5)
    })

    it('evaluates ->first and ->last', () => {
      expect(evalExpr('items->first', { measurements: { items: [10, 20, 30] } })).toBe(10)
      expect(evalExpr('items->last', { measurements: { items: [10, 20, 30] } })).toBe(30)
    })

    it('evaluates logical operators', () => {
      expect(evalExpr('a and b', { measurements: { a: true, b: true } })).toBe(true)
      expect(evalExpr('a or b', { measurements: { a: false, b: true } })).toBe(true)
      expect(evalExpr('not a', { measurements: { a: true } })).toBe(false)
    })
  })

  describe('specification examples from R60', () => {
    it('derived field — load cell error', () => {
      const result = evalExpr(
        'ocl{(avg_indication - reference_indication) / $context.conversion_factor_f}',
        {
          measurements: { avg_indication: 100.5, reference_indication: 100 },
          contextVars: { $context: { conversion_factor_f: 1.0 } },
        },
      )
      expect(result).toBeCloseTo(0.5, 5)
    })

    it('derived field — maximum creep change', () => {
      const creep_readings = [
        { change_v: 0.1 },
        { change_v: 0.5 },
        { change_v: 0.3 },
      ]
      const result = evalExpr(
        'ocl{creep_readings->collect(r | r.change_v)->max}',
        { measurements: { creep_readings } },
      )
      expect(result).toBe(0.5)
    })

    it('derived field — creep at specific time', () => {
      const readings = [
        { time_minutes: 20, change_v: 0.1 },
        { time_minutes: 30, change_v: 0.5 },
        { time_minutes: 40, change_v: 0.3 },
      ]
      const result = evalExpr(
        "ocl{readings->select(r | r.time_minutes = 30)->first.change_v}",
        { measurements: { readings } },
      )
      expect(result).toBe(0.5)
    })

    it('evaluated field — MPE check', () => {
      const result = evalExpr(
        'ocl{abs(error_EL) <= abs(mpe)}',
        { measurements: { error_EL: 0.3, mpe: 0.5 } },
      )
      expect(result).toBe(true)
    })

    it('pass/fail — conjunction', () => {
      const result = evalExpr(
        "ocl{r1 = 'pass' and r2 = 'pass' and r3 = 'pass'}",
        { measurements: { r1: 'pass', r2: 'pass', r3: 'pass' } },
      )
      expect(result).toBe(true)
    })

    it('pass/fail — conjunction with failure', () => {
      // r2 = 'fail' is TRUE because r2 IS 'fail'
      // So the overall conjunction is still true
      const result = evalExpr(
        "ocl{r1 = 'pass' and r2 = 'fail' and r3 = 'pass'}",
        { measurements: { r1: 'pass', r2: 'fail', r3: 'pass' } },
      )
      expect(result).toBe(true)
    })

    it('pass/fail — conjunction with actual mismatch', () => {
      // r2 = 'pass' is FALSE because r2 is 'fail'
      const result = evalExpr(
        "ocl{r1 = 'pass' and r2 = 'pass' and r3 = 'pass'}",
        { measurements: { r1: 'pass', r2: 'fail', r3: 'pass' } },
      )
      expect(result).toBe(false)
    })

    it('nested collection quantifier', () => {
      const series = [
        { test_loads: [{ within_mpe: 'yes' }, { within_mpe: 'yes' }] },
        { test_loads: [{ within_mpe: 'yes' }, { within_mpe: 'no' }] },
      ]
      const result = evalExpr(
        "ocl{series->forAll(t | t.test_loads->forAll(l | l.within_mpe = 'yes'))}",
        { measurements: { series } },
      )
      expect(result).toBe(false)
    })
  })
})

// ═══════════════════════════════════════════════════════════
// 4. Validator
// ═══════════════════════════════════════════════════════════

describe('OCL Validator', () => {
  describe('parse errors', () => {
    it('reports parse errors', () => {
      const result = validateOclExpression('a + ')
      expect(result.valid).toBe(false)
      expect(result.issues[0].message).toContain('Parse error')
    })
  })

  describe('valid expressions', () => {
    it('accepts simple arithmetic', () => {
      const result = validateOclExpression('a + b', {
        knownIdentifiers: new Set(['a', 'b']),
      })
      expect(result.valid).toBe(true)
      expect(result.issues).toHaveLength(0)
    })

    it('accepts ocl{} prefixed expressions', () => {
      const result = validateOclExpression('ocl{a + b}', {
        knownIdentifiers: new Set(['a', 'b']),
      })
      expect(result.valid).toBe(true)
    })

    it('accepts context variables', () => {
      const result = validateOclExpression('$context.p_LC')
      expect(result.valid).toBe(true)
    })

    it('accepts $index', () => {
      const result = validateOclExpression('$index')
      expect(result.valid).toBe(true)
    })

    it('accepts collection ops with lambdas', () => {
      const result = validateOclExpression('items->collect(r | r.value)', {
        knownIdentifiers: new Set(['items']),
      })
      expect(result.valid).toBe(true)
    })
  })

  describe('unresolved identifiers', () => {
    it('warns about unknown identifiers when knownIdentifiers is provided', () => {
      const result = validateOclExpression('unknown_field + 1', {
        knownIdentifiers: new Set(['known_field']),
      })
      expect(result.valid).toBe(true) // warnings don't invalidate
      expect(result.issues.some(i => i.message.includes('unknown_field'))).toBe(true)
    })

    it('does not warn when knownIdentifiers is not provided', () => {
      const result = validateOclExpression('some_field + 1')
      expect(result.issues).toHaveLength(0)
    })
  })

  describe('unknown context variables', () => {
    it('reports error for unknown context variable', () => {
      const result = validateOclExpression('$unknown_var')
      expect(result.valid).toBe(false)
      expect(result.issues[0].message).toContain('Unknown context variable')
    })

    it('reports error for $index with property access', () => {
      const result = validateOclExpression('$index.foo')
      expect(result.valid).toBe(false)
      expect(result.issues[0].message).toContain('$index does not support')
    })
  })

  describe('unknown functions', () => {
    it('reports error for unknown function', () => {
      const result = validateOclExpression('foobar(1)')
      expect(result.valid).toBe(false)
      expect(result.issues[0].message).toContain('Unknown function')
    })
  })

  describe('collection operations', () => {
    it('reports error when lambda-requiring op has no lambda', () => {
      const result = validateOclExpression('items->collect')
      // This should fail parse since collect expects (lambda)
      // Actually it would be a parse error, not a validation error
      expect(result.valid).toBe(false)
    })
  })

  describe('prev() validation', () => {
    it('reports error for prev() with wrong arg count', () => {
      const result = validateOclExpression('prev()')
      expect(result.valid).toBe(false)
      expect(result.issues.some(i => i.message.includes('prev() requires'))).toBe(true)
    })
  })

  describe('circular dependency detection', () => {
    it('detects simple circular dependency', () => {
      const defs = [
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] },
      ]
      const cycles = detectCircularDependencies(defs)
      expect(cycles.length).toBeGreaterThan(0)
    })

    it('returns no cycles for acyclic graph', () => {
      const defs = [
        { id: 'a', dependsOn: [] },
        { id: 'b', dependsOn: ['a'] },
        { id: 'c', dependsOn: ['b'] },
      ]
      const cycles = detectCircularDependencies(defs)
      expect(cycles).toHaveLength(0)
    })

    it('detects longer cycle', () => {
      const defs = [
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['c'] },
        { id: 'c', dependsOn: ['a'] },
      ]
      const cycles = detectCircularDependencies(defs)
      expect(cycles.length).toBeGreaterThan(0)
    })
  })
})
