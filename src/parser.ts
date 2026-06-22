// ═══════════════════════════════════════════════════════════════════
// OCL AST Parser
// Parses tokenized OCL expressions into an Abstract Syntax Tree.
// Supports the full OCL measurement evaluation subset:
//   - Arithmetic: + - * / ^ %
//   - Comparison: < > <= >= = <> !=
//   - Logical: and or not xor implies
//   - Collection: ->max() ->min() ->sum() ->count() ->average()
//                 ->collect(lambda) ->select(lambda) ->reject(lambda)
//                 ->forAll(lambda) ->exists(lambda) ->any(lambda)
//                 ->size ->first ->last ->flatten ->asSet
//                 ->isEmpty ->notEmpty
//   - Navigation: self.property, [measurement_ref], property chains
//   - Context vars: $context.field, $index, $self, $root, $parent, $form.field
//   - Lambda: identifier | expression  and  identifier => expression
//   - Functions: abs(), round(), floor(), ceil(), sqrt(), pow(), prev()
//   - Quantifiers: every(), any()
//   - Conditional: if then else endif
//   - Let: let x = expr in expr
// ═══════════════════════════════════════════════════════════════════

import type { Token, TokenType } from './lexer'
import { tokenize, stripOclPrefix } from './lexer'

// ── AST Node Types ─────────────────────────────────────

export type ASTNode =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | MeasurementRef
  | PropertyAccess
  | BinaryOp
  | UnaryOp
  | FunctionCall
  | CollectionOp
  | QuantifierExpr
  | ConditionalExpr
  | LetExpr
  | InExpr
  | SelfExpr
  | ContextVarExpr
  | LambdaExpr
  | IndexAccessExpr

export interface NumberLiteral { kind: 'number'; value: number }
export interface StringLiteral { kind: 'string'; value: string }
export interface BooleanLiteral { kind: 'boolean'; value: boolean }
export interface MeasurementRef { kind: 'measurement_ref'; id: string; formId?: string }
export interface PropertyAccess { kind: 'property'; object: ASTNode; property: string }
export interface BinaryOp {
  kind: 'binary'
  op: '+' | '-' | '*' | '/' | '%' | '^' | '<' | '>' | '<=' | '>=' | '=' | '<>' | 'and' | 'or' | 'xor' | 'implies'
  left: ASTNode
  right: ASTNode
}
export interface UnaryOp { kind: 'unary'; op: '-' | 'not'; operand: ASTNode }
export interface FunctionCall { kind: 'call'; name: string; args: ASTNode[] }
export interface CollectionOp {
  kind: 'collection'
  source: ASTNode
  operation: 'max' | 'min' | 'sum' | 'count' | 'average' | 'collect' | 'select'
    | 'reject' | 'forAll' | 'exists' | 'any' | 'size' | 'first' | 'last'
    | 'flatten' | 'asSet' | 'isEmpty' | 'notEmpty'
  lambda?: LambdaExpr
}
export interface QuantifierExpr {
  kind: 'quantifier'
  quantifier: 'every' | 'any'
  source: ASTNode
  condition?: ASTNode
}
export interface ConditionalExpr { kind: 'conditional'; condition: ASTNode; thenExpr: ASTNode; elseExpr: ASTNode }
export interface LetExpr { kind: 'let'; varName: string; value: ASTNode; body: ASTNode }
export interface InExpr { kind: 'in_expr'; value: ASTNode; values: ASTNode[] }
export interface SelfExpr { kind: 'self' }
export interface ContextVarExpr { kind: 'context_var'; name: string; path: string[] }
export interface LambdaExpr { kind: 'lambda'; paramName: string; body: ASTNode }
export interface IndexAccessExpr { kind: 'index_access'; object: ASTNode; index: ASTNode }

// ── Parser ──────────────────────────────────────────────

const COLLECTION_OPS_WITH_LAMBDA = new Set([
  'collect', 'select', 'reject', 'forAll', 'exists', 'any',
])
const COLLECTION_OPS_NO_LAMBDA = new Set([
  'max', 'min', 'sum', 'count', 'average', 'size', 'first',
  'last', 'flatten', 'asSet', 'isEmpty', 'notEmpty',
])
const ALL_COLLECTION_OPS = new Set([...COLLECTION_OPS_WITH_LAMBDA, ...COLLECTION_OPS_NO_LAMBDA])

export class OclParser {
  private tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parse(): ASTNode {
    const result = this.parseImplies()
    if (this.current().type !== 'EOF') {
      throw new Error(`Unexpected token at position ${this.current().position}: ${this.current().value}`)
    }
    return result
  }

  private current(): Token { return this.tokens[this.pos] }
  private peek(offset = 0): Token { return this.tokens[this.pos + offset] }
  private advance(): Token { return this.tokens[this.pos++] }
  private expect(type: TokenType): Token {
    const t = this.advance()
    if (t.type !== type) throw new Error(`Expected ${type}, got ${t.type} (${t.value})`)
    return t
  }

  // Operator precedence (lowest to highest):
  // implies → xor → or → and → not → comparison → in → addition → multiplication → unary → power → postfix → primary

  private parseImplies(): ASTNode {
    let left = this.parseXor()
    while (this.current().type === 'IMPLIES') {
      this.advance()
      left = { kind: 'binary', op: 'implies', left, right: this.parseXor() }
    }
    return left
  }

  private parseXor(): ASTNode {
    let left = this.parseOr()
    while (this.current().type === 'XOR') {
      this.advance()
      left = { kind: 'binary', op: 'xor', left, right: this.parseOr() }
    }
    return left
  }

  private parseOr(): ASTNode {
    let left = this.parseAnd()
    while (this.current().type === 'OR') {
      this.advance()
      left = { kind: 'binary', op: 'or', left, right: this.parseAnd() }
    }
    return left
  }

  private parseAnd(): ASTNode {
    let left = this.parseNot()
    while (this.current().type === 'AND') {
      this.advance()
      left = { kind: 'binary', op: 'and', left, right: this.parseNot() }
    }
    return left
  }

  private parseNot(): ASTNode {
    if (this.current().type === 'NOT') {
      this.advance()
      return { kind: 'unary', op: 'not', operand: this.parseNot() }
    }
    return this.parseComparison()
  }

  private parseComparison(): ASTNode {
    let left = this.parseIn()
    const compOps: TokenType[] = ['LTE', 'GTE', 'LT', 'GT', 'EQ', 'NEQ']
    const opMap: Record<string, string> = { LTE: '<=', GTE: '>=', LT: '<', GT: '>', EQ: '=', NEQ: '<>' }
    while (compOps.includes(this.current().type)) {
      const op = opMap[this.advance().type]!
      left = { kind: 'binary', op: op as BinaryOp['op'], left, right: this.parseIn() }
    }
    return left
  }

  private parseIn(): ASTNode {
    let left = this.parseAddition()
    if (this.current().type === 'IN') {
      this.advance()
      const values: ASTNode[] = []
      if (this.current().type === 'LBRACKET') {
        this.advance() // {
        values.push(this.parseAddition())
        while (this.current().type === 'COMMA') { this.advance(); values.push(this.parseAddition()) }
        this.expect('RBRACKET') // }
      } else {
        values.push(this.parseAddition())
      }
      return { kind: 'in_expr', value: left, values }
    }
    return left
  }

  private parseAddition(): ASTNode {
    let left = this.parseMultiplication()
    while (this.current().type === 'PLUS' || this.current().type === 'MINUS') {
      const op = this.advance().value as '+' | '-'
      left = { kind: 'binary', op, left, right: this.parseMultiplication() }
    }
    return left
  }

  private parseMultiplication(): ASTNode {
    let left = this.parseUnary()
    while (this.current().type === 'STAR' || this.current().type === 'SLASH' || this.current().type === 'PERCENT') {
      const op = this.advance().value as '*' | '/' | '%'
      left = { kind: 'binary', op, left, right: this.parseUnary() }
    }
    return left
  }

  private parseUnary(): ASTNode {
    if (this.current().type === 'MINUS') {
      this.advance()
      return { kind: 'unary', op: '-', operand: this.parseUnary() }
    }
    return this.parsePower()
  }

  private parsePower(): ASTNode {
    let base = this.parsePostfix()
    if (this.current().type === 'CARET') {
      this.advance()
      return { kind: 'binary', op: '^', left: base, right: this.parseUnary() }
    }
    return base
  }

  private parsePostfix(): ASTNode {
    let node = this.parsePrimary()

    while (true) {
      if (this.current().type === 'DOT') {
        this.advance()
        const prop = this.expect('IDENTIFIER').value
        node = { kind: 'property', object: node, property: prop }
      } else if (this.current().type === 'ARROW') {
        this.advance()
        const op = this.expect('IDENTIFIER').value
        if (!ALL_COLLECTION_OPS.has(op)) throw new Error(`Unknown collection operation: ->${op}`)
        let lambda: LambdaExpr | undefined
        if (COLLECTION_OPS_WITH_LAMBDA.has(op)) {
          this.expect('LPAREN')
          lambda = this.parseLambda()
          this.expect('RPAREN')
        } else if (COLLECTION_OPS_NO_LAMBDA.has(op)) {
          // Optional empty parens: ->size, ->first, etc.
          if (this.current().type === 'LPAREN') {
            this.advance()
            this.expect('RPAREN')
          }
        }
        node = { kind: 'collection', source: node, operation: op as CollectionOp['operation'], lambda }
      } else if (this.current().type === 'LBRACKET') {
        // Index access: expr[index] — but NOT if next is IDENTIFIER followed by ]
        // (that's a [measurement_ref] which is handled in tokenize)
        this.advance()
        const indexExpr = this.parseImplies()
        this.expect('RBRACKET')
        node = { kind: 'index_access', object: node, index: indexExpr }
      } else {
        break
      }
    }
    return node
  }

  /**
   * Parse a lambda expression: `identifier | expression` or `identifier => expression`
   * The PIPE or FAT_ARROW token separates the parameter name from the body.
   */
  private parseLambda(): LambdaExpr {
    const paramName = this.expect('IDENTIFIER').value
    if (this.current().type === 'PIPE') {
      this.advance()
    } else if (this.current().type === 'FAT_ARROW') {
      this.advance()
    } else {
      throw new Error(`Expected '|' or '=>' in lambda, got ${this.current().type} (${this.current().value})`)
    }
    const body = this.parseImplies()
    return { kind: 'lambda', paramName, body }
  }

  private parsePrimary(): ASTNode {
    const t = this.current()

    switch (t.type) {
      case 'NUMBER':
        this.advance()
        return { kind: 'number', value: parseFloat(t.value) }

      case 'STRING':
        this.advance()
        return { kind: 'string', value: t.value }

      case 'BOOLEAN':
        this.advance()
        return { kind: 'boolean', value: t.value.toLowerCase() === 'true' }

      case 'MEASUREMENT_REF': {
        this.advance()
        const parts = t.value.split(':')
        if (parts.length === 2) {
          return { kind: 'measurement_ref', id: parts[1], formId: parts[0] }
        }
        return { kind: 'measurement_ref', id: t.value }
      }

      case 'CONTEXT_VAR': {
        this.advance()
        const name = t.value // e.g., "$context", "$index", "$self", "$root", "$prev", "$form"
        const path: string[] = []
        // Consume dotted property access: $context.field.subfield
        while (this.current().type === 'DOT') {
          this.advance()
          path.push(this.expect('IDENTIFIER').value)
        }
        return { kind: 'context_var', name, path }
      }

      case 'SELF':
        this.advance()
        return { kind: 'self' }

      case 'IDENTIFIER': {
        // Check if it's a function call
        if (this.peek(1).type === 'LPAREN') {
          const name = this.advance().value
          this.expect('LPAREN')
          const args: ASTNode[] = []
          if (this.current().type !== 'RPAREN') {
            args.push(this.parseImplies())
            while (this.current().type === 'COMMA') { this.advance(); args.push(this.parseImplies()) }
          }
          this.expect('RPAREN')
          return { kind: 'call', name, args }
        }
        // Plain identifier — treat as measurement reference
        this.advance()
        return { kind: 'measurement_ref', id: t.value }
      }

      case 'LPAREN': {
        this.advance()
        const expr = this.parseImplies()
        this.expect('RPAREN')
        return expr
      }

      case 'IF': {
        this.advance()
        const condition = this.parseImplies()
        this.expect('THEN')
        const thenExpr = this.parseImplies()
        let elseExpr: ASTNode = { kind: 'number', value: 0 }
        if (this.current().type === 'ELSE') {
          this.advance()
          elseExpr = this.parseImplies()
        }
        this.expect('ENDIF')
        return { kind: 'conditional', condition, thenExpr, elseExpr }
      }

      case 'LET': {
        this.advance()
        const varName = this.expect('IDENTIFIER').value
        this.expect('EQ')
        const value = this.parseImplies()
        this.expect('IN_EXPR')
        const body = this.parseImplies()
        return { kind: 'let', varName, value, body }
      }

      default:
        throw new Error(`Unexpected token: ${t.type} (${t.value}) at position ${t.position}`)
    }
  }
}

export function parseOcl(input: string): ASTNode {
  const stripped = stripOclPrefix(input)
  const tokens = tokenize(stripped)
  return new OclParser(tokens).parse()
}
