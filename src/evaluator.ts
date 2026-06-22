// ═══════════════════════════════════════════════════════════════════
// OCL Evaluator
// Evaluates OCL AST nodes against a measurement context.
// Resolves [measurement_ref] lookups, context variables ($context.*,
// $index, $self, $root, $prev, $form), performs arithmetic, collection
// operations with lambda expressions, quantifiers, and pass/fail
// determination.
// ═══════════════════════════════════════════════════════════════════

import type { ASTNode, BinaryOp, CollectionOp, ConditionalExpr, ContextVarExpr, FunctionCall, IndexAccessExpr, InExpr, LambdaExpr, LetExpr, MeasurementRef, PropertyAccess, QuantifierExpr, UnaryOp } from './parser'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OclValue = any

export interface EvaluationContext {
  /** Current measurement values (field values keyed by ID) */
  measurements: Record<string, OclValue>
  /** Cross-form references: formId -> fieldId -> value */
  crossForm?: Record<string, Record<string, OclValue>>
  /** Table bindings for lookup functions */
  tables?: Record<string, { binding: Record<string, unknown[]>; dimension?: string }>
  /** Dimension values (e.g., accuracy_class, n_LC) */
  dimensions?: Record<string, string | number | boolean | undefined>
  /** Current entity properties (legacy self binding) */
  self?: Record<string, OclValue>
  /** Context variables for OCL evaluation */
  contextVars?: ContextVars
}

/** Context variables available during OCL expression evaluation */
export interface ContextVars {
  /** Calculation context fields (e.g., accuracy_class, p_LC) */
  $context?: Record<string, OclValue>
  /** Current loop index in DATALIST iteration (0-based) */
  $index?: number
  /** Current entity being evaluated */
  $self?: Record<string, OclValue>
  /** Root of the test report */
  $root?: Record<string, OclValue>
  /** Parent scope in nested structures */
  $parent?: Record<string, OclValue>
  /** Previous element values in DATALIST iteration */
  $prev?: Record<string, OclValue>
  /** Other fields in the same form */
  $form?: Record<string, OclValue>
}

/** @deprecated Use EvaluationContext instead */
export type MeasurementContext = EvaluationContext

export class OclEvaluator {
  private ctx: EvaluationContext

  constructor(context: EvaluationContext) {
    this.ctx = context
  }

  evaluate(node: ASTNode): OclValue {
    switch (node.kind) {
      case 'number': return node.value
      case 'string': return node.value
      case 'boolean': return node.value
      case 'self': return this.ctx.self ?? null
      case 'measurement_ref': return this.resolveRef(node)
      case 'property': return this.evalProperty(node)
      case 'binary': return this.evalBinary(node)
      case 'unary': return this.evalUnary(node)
      case 'call': return this.evalCall(node)
      case 'collection': return this.evalCollection(node)
      case 'quantifier': return this.evalQuantifier(node)
      case 'conditional': return this.evalConditional(node)
      case 'let': return this.evalLet(node)
      case 'in_expr': return this.evalIn(node)
      case 'context_var': return this.evalContextVar(node)
      case 'lambda': return this.evalLambda(node)
      case 'index_access': return this.evalIndexAccess(node)
    }
  }

  // ── Context Variable Resolution ────────────────────────

  private evalContextVar(node: ContextVarExpr): OclValue {
    const cv = this.ctx.contextVars
    if (!cv) return null

    let base: OclValue = null
    switch (node.name) {
      case '$context': base = cv.$context ?? null; break
      case '$index': return cv.$index ?? null
      case '$self': base = cv.$self ?? this.ctx.self ?? null; break
      case '$root': base = cv.$root ?? null; break
      case '$parent': base = cv.$parent ?? null; break
      case '$prev': base = cv.$prev ?? null; break
      case '$form': base = cv.$form ?? null; break
      default: return null
    }

    // Traverse dotted path
    for (const prop of node.path) {
      if (base === null || base === undefined) return null
      if (typeof base === 'object' && !Array.isArray(base)) {
        base = (base as Record<string, OclValue>)[prop] ?? null
      } else {
        return null
      }
    }

    return base
  }

  // ── Lambda Evaluation ──────────────────────────────────

  /**
   * Evaluate a lambda by returning a closure object.
   * The closure captures the parameter name and body expression,
   * ready to be applied by collection operations.
   */
  private evalLambda(node: LambdaExpr): LambdaExpr {
    return node
  }

  /**
   * Apply a lambda to a value, binding the parameter name and evaluating the body.
   */
  private applyLambda(lambda: LambdaExpr, value: OclValue): OclValue {
    return this.withLambda(lambda.paramName, value, () => this.evaluate(lambda.body))
  }

  // ── Index Access ───────────────────────────────────────

  private evalIndexAccess(node: IndexAccessExpr): OclValue {
    const obj = this.evaluate(node.object)
    const index = this.evaluate(node.index)
    if (Array.isArray(obj) && typeof index === 'number') {
      return obj[index] ?? null
    }
    if (typeof obj === 'string' && typeof index === 'number') {
      return obj[index] ?? null
    }
    return null
  }

  // ── Reference Resolution ───────────────────────────────

  private resolveRef(ref: MeasurementRef): OclValue {
    if (ref.formId) {
      return this.ctx.crossForm?.[ref.formId]?.[ref.id] ?? null
    }
    if (this.ctx.self && ref.id in this.ctx.self) {
      return this.ctx.self[ref.id]
    }
    if (ref.id in this.ctx.measurements) {
      return this.ctx.measurements[ref.id]
    }
    if (this.ctx.dimensions && ref.id in this.ctx.dimensions) {
      return this.ctx.dimensions[ref.id] as OclValue
    }
    return null
  }

  private evalProperty(node: PropertyAccess): OclValue {
    const obj = this.evaluate(node.object)
    if (obj === null || obj === undefined) return null
    if (typeof obj === 'object' && !Array.isArray(obj)) {
      return (obj as Record<string, OclValue>)[node.property] ?? null
    }
    return null
  }

  private evalBinary(node: BinaryOp): OclValue {
    const left = this.evaluate(node.left)
    const right = this.evaluate(node.right)

    switch (node.op) {
      case '+': return this.toNum(left) + this.toNum(right)
      case '-': return this.toNum(left) - this.toNum(right)
      case '*': return this.toNum(left) * this.toNum(right)
      case '/': {
        const r = this.toNum(right)
        return r === 0 ? NaN : this.toNum(left) / r
      }
      case '%': return this.toNum(left) % this.toNum(right)
      case '^': return Math.pow(this.toNum(left), this.toNum(right))
      case '<': {
        const l = this.toNum(left), r = this.toNum(right)
        return (Number.isNaN(l) || Number.isNaN(r)) ? false : l < r
      }
      case '>': {
        const l = this.toNum(left), r = this.toNum(right)
        return (Number.isNaN(l) || Number.isNaN(r)) ? false : l > r
      }
      case '<=': {
        const l = this.toNum(left), r = this.toNum(right)
        return (Number.isNaN(l) || Number.isNaN(r)) ? false : l <= r
      }
      case '>=': {
        const l = this.toNum(left), r = this.toNum(right)
        return (Number.isNaN(l) || Number.isNaN(r)) ? false : l >= r
      }
      case '=': return this.oclEquals(left, right)
      case '<>': return !this.oclEquals(left, right)
      case 'and': return this.toBool(left) && this.toBool(right)
      case 'or': return this.toBool(left) || this.toBool(right)
      case 'xor': return this.toBool(left) !== this.toBool(right)
      case 'implies': return !this.toBool(left) || this.toBool(right)
    }
    return null
  }

  private evalUnary(node: UnaryOp): OclValue {
    const val = this.evaluate(node.operand)
    switch (node.op) {
      case '-': return -this.toNum(val)
      case 'not': return !this.toBool(val)
    }
    return null
  }

  private evalCall(node: FunctionCall): OclValue {
    const args = node.args.map(a => this.evaluate(a))
    const firstArg = args[0] ?? null

    switch (node.name) {
      case 'abs': return Math.abs(this.toNum(firstArg))
      case 'round': {
        const val = this.toNum(firstArg)
        const places = args.length > 1 ? this.toNum(args[1]) : 0
        const factor = Math.pow(10, places)
        return Math.round(val * factor) / factor
      }
      case 'floor': return Math.floor(this.toNum(firstArg))
      case 'ceil': return Math.ceil(this.toNum(firstArg))
      case 'sqrt': return Math.sqrt(this.toNum(firstArg))
      case 'pow': return Math.pow(this.toNum(firstArg), this.toNum(args[1] ?? 0))
      case 'max': return args.length > 1 ? Math.max(...args.map(v => this.toNum(v))) : this.arrMax(this.toArray(firstArg))
      case 'min': return args.length > 1 ? Math.min(...args.map(v => this.toNum(v))) : this.arrMin(this.toArray(firstArg))
      case 'sum': return this.arrSum(this.toArray(firstArg))
      case 'avg':
      case 'mean': return this.arrAvg(this.toArray(firstArg))
      case 'count': return this.toArray(firstArg).length
      case 'size': {
        if (Array.isArray(firstArg)) return firstArg.length
        if (typeof firstArg === 'string') return firstArg.length
        return 0
      }
      case 'every': return this.toArray(firstArg).every(v => this.toBool(v))
      case 'any': return this.toArray(firstArg).some(v => this.toBool(v))
      case 'flatten': {
        const arr = this.toArray(firstArg)
        return arr.flat(Infinity) as OclValue[]
      }
      case 'first': return this.toArray(firstArg)[0] ?? null
      case 'last': { const a = this.toArray(firstArg); return a[a.length - 1] ?? null }
      case 'lookup_mpe': return this.evalLookupMpe(args)
      case 'lookup': return this.evalLookup(args)
      case 'prev': return this.evalPrev(args)
      default:
        throw new Error(`Unknown function: ${node.name}`)
    }
  }

  /**
   * prev(field) — returns the value of `field` from the previous element
   * in a DATALIST iteration. For $index = 0, returns 0.
   */
  private evalPrev(args: OclValue[]): OclValue {
    const fieldName = typeof args[0] === 'string' ? args[0] : String(args[0] ?? '')
    const prev = this.ctx.contextVars?.$prev
    if (!prev) return 0
    return prev[fieldName] ?? 0
  }

  private evalLookupMpe(args: OclValue[]): OclValue {
    const loadValue = this.toNum(args[0])
    const accuracyClass = String(args[1] ?? '')
    const pLC = this.toNum(args[2] ?? 0.7)

    const table = this.ctx.tables?.['mpe_tiers']
    if (!table) return null

    const tiers = table.binding[accuracyClass] as Array<{ min: number; max?: number; factor: number }> | undefined
    if (!tiers) return null

    for (const tier of tiers) {
      const max = tier.max ?? Infinity
      if (loadValue >= tier.min && loadValue < max) {
        return tier.factor * pLC
      }
    }
    return tiers.length ? tiers[tiers.length - 1].factor * pLC : null
  }

  private evalLookup(args: OclValue[]): OclValue {
    const tableName = String(args[0] ?? '')
    const column = String(args[1] ?? '')
    const filters = args[2]

    const table = this.ctx.tables?.[tableName]
    if (!table) return null

    if (typeof filters === 'object' && filters !== null && !Array.isArray(filters)) {
      const filterMap = filters as Record<string, OclValue>
      const binding = table.binding
      for (const [key, entries] of Object.entries(binding)) {
        if (!Array.isArray(entries)) continue
        const firstKey = String(filterMap[Object.keys(filterMap)[0]] ?? '')
        if (key !== firstKey) continue
        for (const entry of entries as Record<string, OclValue>[]) {
          let match = true
          for (const [fk, fv] of Object.entries(filterMap)) {
            if (entry[fk] !== fv) { match = false; break }
          }
          if (match) return column === '*' ? entry : (entry[column] ?? null)
        }
      }
    }
    return null
  }

  private evalCollection(node: CollectionOp): OclValue {
    const source = this.evaluate(node.source)
    const arr = this.toArray(source)

    switch (node.operation) {
      case 'max': return this.arrMax(arr)
      case 'min': return this.arrMin(arr)
      case 'sum': return this.arrSum(arr)
      case 'count': return arr.length
      case 'average': return this.arrAvg(arr)
      case 'size': return arr.length
      case 'first': return arr[0] ?? null
      case 'last': { const a = arr; return a[a.length - 1] ?? null }
      case 'flatten': return arr.flat(Infinity) as OclValue[]
      case 'asSet': {
        const seen = new Set<string>()
        const result: OclValue[] = []
        for (const v of arr) {
          const key = JSON.stringify(v)
          if (!seen.has(key)) { seen.add(key); result.push(v) }
        }
        return result
      }
      case 'isEmpty': return arr.length === 0
      case 'notEmpty': return arr.length > 0

      case 'collect': {
        if (!node.lambda) return arr
        return arr.map(item => this.applyLambda(node.lambda!, item))
      }
      case 'select': {
        if (!node.lambda) return arr
        return arr.filter(item => this.toBool(this.applyLambda(node.lambda!, item)))
      }
      case 'reject': {
        if (!node.lambda) return arr
        return arr.filter(item => !this.toBool(this.applyLambda(node.lambda!, item)))
      }
      case 'forAll': {
        if (!node.lambda) return true
        return arr.every(item => this.toBool(this.applyLambda(node.lambda!, item)))
      }
      case 'exists': {
        if (!node.lambda) return arr.length > 0
        return arr.some(item => this.toBool(this.applyLambda(node.lambda!, item)))
      }
      case 'any': {
        if (!node.lambda) return arr.length > 0
        return arr.some(item => this.toBool(this.applyLambda(node.lambda!, item)))
      }
    }
  }

  private evalQuantifier(node: QuantifierExpr): OclValue {
    const source = this.evaluate(node.source)
    const arr = this.toArray(source)

    if (node.condition) {
      const cond = node.condition
      const results = arr.map(item => {
        this.ctx.measurements['_'] = item
        return this.toBool(this.evaluate(cond))
      })
      return node.quantifier === 'every' ? results.every(Boolean) : results.some(Boolean)
    }

    return node.quantifier === 'every'
      ? arr.every(v => this.toBool(v))
      : arr.some(v => this.toBool(v))
  }

  private evalConditional(node: ConditionalExpr): OclValue {
    return this.toBool(this.evaluate(node.condition))
      ? this.evaluate(node.thenExpr)
      : this.evaluate(node.elseExpr)
  }

  private evalLet(node: LetExpr): OclValue {
    const value = this.evaluate(node.value)
    return this.withLambda(node.varName, value, () => this.evaluate(node.body))
  }

  private evalIn(node: InExpr): OclValue {
    const value = this.evaluate(node.value)
    const values = node.values.map(v => this.evaluate(v))
    return values.some(v => this.oclEquals(value, v))
  }

  // ── Helpers ────────────────────────────────────────────

  private withLambda<T>(varName: string, value: OclValue, fn: () => T): T {
    const saved = this.ctx.measurements[varName]
    this.ctx.measurements[varName] = value
    const result = fn()
    this.ctx.measurements[varName] = saved
    return result
  }

  private toNum(v: OclValue): number {
    if (typeof v === 'number') return v
    if (typeof v === 'boolean') return v ? 1 : 0
    if (typeof v === 'string') return parseFloat(v) || 0
    return 0
  }

  private toBool(v: OclValue): boolean {
    if (typeof v === 'boolean') return v
    if (typeof v === 'number') return v !== 0
    if (Array.isArray(v)) return v.length > 0
    return v !== null && v !== undefined
  }

  private toArray(v: OclValue): OclValue[] {
    if (Array.isArray(v)) return v
    if (v === null || v === undefined) return []
    return [v]
  }

  private arrMax(arr: OclValue[]): OclValue {
    return arr.length ? Math.max(...arr.map(v => this.toNum(v))) : null
  }

  private arrMin(arr: OclValue[]): OclValue {
    return arr.length ? Math.min(...arr.map(v => this.toNum(v))) : null
  }

  private arrSum(arr: OclValue[]): number {
    let sum = 0
    for (const v of arr) sum += this.toNum(v)
    return sum
  }

  private arrAvg(arr: OclValue[]): number {
    if (!arr.length) return 0
    return this.arrSum(arr) / arr.length
  }

  private oclEquals(a: OclValue, b: OclValue): boolean {
    if (a === b) return true
    if (a === null || b === null) return a === b
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-10
    return String(a) === String(b)
  }
}
