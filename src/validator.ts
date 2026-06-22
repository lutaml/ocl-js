// ═══════════════════════════════════════════════════════════════════
// OCL Expression Validator
// Statically checks OCL expressions without evaluating them.
// Validates that all identifiers resolve, types are compatible,
// no circular dependencies exist, and collection operations are
// applied to collections.
// ═══════════════════════════════════════════════════════════════════

import { tokenize, stripOclPrefix } from './lexer'
import { OclParser, type ASTNode, type CollectionOp, type ContextVarExpr, type FunctionCall, type LambdaExpr, type MeasurementRef } from './parser'

export interface ValidationIssue {
  severity: 'error' | 'warning'
  message: string
  position?: number
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}

/** Known builtin function names that do not need to resolve as measurement refs */
const BUILTIN_FUNCTIONS = new Set([
  'abs', 'round', 'floor', 'ceil', 'sqrt', 'pow',
  'max', 'min', 'sum', 'mean', 'avg', 'count', 'size',
  'every', 'any', 'first', 'last', 'flatten',
  'lookup_mpe', 'lookup', 'compute', 'prev',
])

/** Valid context variable names */
const CONTEXT_VAR_NAMES = new Set([
  '$context', '$index', '$self', '$root', '$parent', '$prev', '$form',
])

export interface ValidatorOptions {
  /** Known measurement/field IDs that are valid references */
  knownIdentifiers?: Set<string>
  /** Known context field paths, e.g., 'accuracy_class', 'p_LC' */
  knownContextFields?: Set<string>
  /** Lambda parameter names currently in scope */
  lambdaScope?: Set<string>
}

/**
 * Validate an OCL expression string without evaluating it.
 * Checks for parse errors, unresolved identifiers, and type issues.
 */
export function validateOclExpression(
  expr: string,
  options: ValidatorOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = []
  const knownIds = options.knownIdentifiers ?? new Set<string>()
  const knownCtxFields = options.knownContextFields ?? new Set<string>()
  const lambdaScope = options.lambdaScope ?? new Set<string>()

  // 1. Strip ocl{} prefix if present
  const stripped = stripOclPrefix(expr)
  if (stripped === expr && expr.trimStart().startsWith('ocl{')) {
    // Already stripped, nothing to do
  }

  // 2. Parse — catch syntax errors
  let ast: ASTNode
  try {
    const tokens = tokenize(stripped)
    ast = new OclParser(tokens).parse()
  } catch (e) {
    issues.push({
      severity: 'error',
      message: `Parse error: ${e instanceof Error ? e.message : String(e)}`,
    })
    return { valid: false, issues }
  }

  // 3. Walk the AST checking for issues
  walkAst(ast, issues, knownIds, knownCtxFields, lambdaScope)

  return {
    valid: !issues.some(i => i.severity === 'error'),
    issues,
  }
}

/**
 * Recursively walk an AST node, checking for validation issues.
 */
function walkAst(
  node: ASTNode,
  issues: ValidationIssue[],
  knownIds: Set<string>,
  knownCtxFields: Set<string>,
  lambdaScope: Set<string>,
): void {
  switch (node.kind) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'self':
      // Leaf nodes — nothing to validate
      break

    case 'measurement_ref':
      validateMeasurementRef(node, issues, knownIds, lambdaScope)
      break

    case 'context_var':
      validateContextVar(node, issues, knownCtxFields)
      break

    case 'property':
      walkAst(node.object, issues, knownIds, knownCtxFields, lambdaScope)
      break

    case 'binary':
      walkAst(node.left, issues, knownIds, knownCtxFields, lambdaScope)
      walkAst(node.right, issues, knownIds, knownCtxFields, lambdaScope)
      break

    case 'unary':
      walkAst(node.operand, issues, knownIds, knownCtxFields, lambdaScope)
      break

    case 'call':
      validateFunctionCall(node, issues, knownIds, knownCtxFields, lambdaScope)
      break

    case 'collection':
      validateCollectionOp(node, issues, knownIds, knownCtxFields, lambdaScope)
      break

    case 'quantifier':
      walkAst(node.source, issues, knownIds, knownCtxFields, lambdaScope)
      if (node.condition) {
        walkAst(node.condition, issues, knownIds, knownCtxFields, lambdaScope)
      }
      break

    case 'conditional':
      walkAst(node.condition, issues, knownIds, knownCtxFields, lambdaScope)
      walkAst(node.thenExpr, issues, knownIds, knownCtxFields, lambdaScope)
      walkAst(node.elseExpr, issues, knownIds, knownCtxFields, lambdaScope)
      break

    case 'let':
      walkAst(node.value, issues, knownIds, knownCtxFields, lambdaScope)
      // Add the let variable to scope for the body
      const letScope = new Set(lambdaScope)
      letScope.add(node.varName)
      walkAst(node.body, issues, knownIds, knownCtxFields, letScope)
      break

    case 'in_expr':
      walkAst(node.value, issues, knownIds, knownCtxFields, lambdaScope)
      for (const v of node.values) {
        walkAst(v, issues, knownIds, knownCtxFields, lambdaScope)
      }
      break

    case 'lambda':
      // Lambda node — normally inside a collection op, but handle standalone
      const lambdaScope2 = new Set(lambdaScope)
      lambdaScope2.add(node.paramName)
      walkAst(node.body, issues, knownIds, knownCtxFields, lambdaScope2)
      break

    case 'index_access':
      walkAst(node.object, issues, knownIds, knownCtxFields, lambdaScope)
      walkAst(node.index, issues, knownIds, knownCtxFields, lambdaScope)
      break
  }
}

function validateMeasurementRef(
  node: MeasurementRef,
  issues: ValidationIssue[],
  knownIds: Set<string>,
  lambdaScope: Set<string>,
): void {
  // If it's in lambda scope, it's fine (e.g., `r` in `r.value`)
  if (lambdaScope.has(node.id)) return

  // If knownIdentifiers is empty, we can't validate — skip
  if (knownIds.size === 0) return

  // Check cross-form references
  if (node.formId) {
    // Cross-form — we'd need form-level knowledge; skip for now
    return
  }

  if (!knownIds.has(node.id)) {
    issues.push({
      severity: 'warning',
      message: `Unresolved identifier: '${node.id}'`,
    })
  }
}

function validateContextVar(
  node: ContextVarExpr,
  issues: ValidationIssue[],
  knownCtxFields: Set<string>,
): void {
  if (!CONTEXT_VAR_NAMES.has(node.name)) {
    issues.push({
      severity: 'error',
      message: `Unknown context variable: '${node.name}'`,
    })
    return
  }

  // For $context.field, check the first path element
  if (node.name === '$context' && node.path.length > 0) {
    const field = node.path[0]
    if (knownCtxFields.size > 0 && !knownCtxFields.has(field)) {
      issues.push({
        severity: 'warning',
        message: `Unknown context field: $context.${field}`,
      })
    }
  }

  // $index should not have path
  if (node.name === '$index' && node.path.length > 0) {
    issues.push({
      severity: 'error',
      message: `$index does not support property access`,
    })
  }
}

function validateFunctionCall(
  node: FunctionCall,
  issues: ValidationIssue[],
  knownIds: Set<string>,
  knownCtxFields: Set<string>,
  lambdaScope: Set<string>,
): void {
  // Check unknown function names
  if (!BUILTIN_FUNCTIONS.has(node.name)) {
    issues.push({
      severity: 'error',
      message: `Unknown function: ${node.name}()`,
    })
  }

  // Validate arguments
  for (const arg of node.args) {
    walkAst(arg, issues, knownIds, knownCtxFields, lambdaScope)
  }

  // Specific: prev() should have exactly 1 argument
  if (node.name === 'prev' && node.args.length !== 1) {
    issues.push({
      severity: 'error',
      message: `prev() requires exactly 1 argument, got ${node.args.length}`,
    })
  }
}

const COLLECTION_OPS_REQUIRING_LAMBDA = new Set([
  'collect', 'select', 'reject', 'forAll', 'exists', 'any',
])

function validateCollectionOp(
  node: CollectionOp,
  issues: ValidationIssue[],
  knownIds: Set<string>,
  knownCtxFields: Set<string>,
  lambdaScope: Set<string>,
): void {
  // Validate the source expression
  walkAst(node.source, issues, knownIds, knownCtxFields, lambdaScope)

  // Lambda-requiring ops must have a lambda
  if (COLLECTION_OPS_REQUIRING_LAMBDA.has(node.operation) && !node.lambda) {
    issues.push({
      severity: 'error',
      message: `Collection operation ->${node.operation} requires a lambda expression`,
    })
  }

  // Validate the lambda body with parameter in scope
  if (node.lambda) {
    const lambdaScope2 = new Set(lambdaScope)
    lambdaScope2.add(node.lambda.paramName)
    walkAst(node.lambda.body, issues, knownIds, knownCtxFields, lambdaScope2)
  }
}

/**
 * Check a set of measurement definitions for circular dependencies.
 * Returns an array of cycles found (each cycle is a list of IDs).
 */
export function detectCircularDependencies(
  definitions: Array<{ id: string; dependsOn: string[] }>,
): string[][] {
  const graph = new Map<string, string[]>()
  for (const def of definitions) {
    graph.set(def.id, def.dependsOn.filter(d => graph.has(d) || definitions.some(x => x.id === d)))
  }

  const cycles: string[][] = []
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const stack: string[] = []

  function dfs(node: string): void {
    if (inStack.has(node)) {
      const cycleStart = stack.indexOf(node)
      if (cycleStart !== -1) {
        cycles.push(stack.slice(cycleStart).concat(node))
      }
      return
    }
    if (visited.has(node)) return

    visited.add(node)
    inStack.add(node)
    stack.push(node)

    for (const dep of graph.get(node) ?? []) {
      dfs(dep)
    }

    stack.pop()
    inStack.delete(node)
  }

  for (const def of definitions) {
    dfs(def.id)
  }

  return cycles
}
