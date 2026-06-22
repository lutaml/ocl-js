// ═══════════════════════════════════════════════════════════════════
// @metanorma/ocl
//
// OCL (Object Constraint Language) expression engine for TypeScript.
// Standalone library — no project-specific dependencies.
// ═══════════════════════════════════════════════════════════════════

export { tokenize, stripOclPrefix, type Token, type TokenType } from './lexer'
export {
  OclParser,
  parseOcl,
  type ASTNode,
  type BinaryOp,
  type BooleanLiteral,
  type CollectionOp,
  type ConditionalExpr,
  type ContextVarExpr,
  type FunctionCall,
  type IndexAccessExpr,
  type InExpr,
  type LambdaExpr,
  type LetExpr,
  type MeasurementRef,
  type NumberLiteral,
  type PropertyAccess,
  type QuantifierExpr,
  type SelfExpr,
  type StringLiteral,
  type UnaryOp,
} from './parser'
export {
  OclEvaluator,
  type EvaluationContext,
  type MeasurementContext,
  type ContextVars,
  type OclValue,
} from './evaluator'
export {
  validateOclExpression,
  detectCircularDependencies,
  type ValidationIssue,
  type ValidationResult,
  type ValidatorOptions,
} from './validator'
