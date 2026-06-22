// ═══════════════════════════════════════════════════════════════════
// OCL Expression Lexer
// Tokenizes OCL-like expressions for the measurement evaluation engine.
// Supports: arithmetic, comparison, logical, collection ops, navigation,
// quantifiers, [MeasurementID] references, context variables ($word),
// lambda separators (|, =>), and ocl{} prefix handling.
// ═══════════════════════════════════════════════════════════════════

export type TokenType =
  | 'NUMBER' | 'STRING' | 'BOOLEAN' | 'IDENTIFIER' | 'MEASUREMENT_REF'
  | 'DOT' | 'ARROW' | 'COMMA' | 'COLON' | 'SEMICOLON' | 'PIPE' | 'FAT_ARROW'
  | 'LPAREN' | 'RPAREN' | 'LBRACKET' | 'RBRACKET'
  | 'PLUS' | 'MINUS' | 'STAR' | 'SLASH' | 'PERCENT' | 'CARET'
  | 'LTE' | 'GTE' | 'LT' | 'GT' | 'EQ' | 'NEQ'
  | 'AND' | 'OR' | 'NOT' | 'XOR' | 'IMPLIES'
  | 'IN' | 'IF' | 'THEN' | 'ELSE' | 'ENDIF'
  | 'LET' | 'IN_EXPR' | 'SELF'
  | 'CONTEXT_VAR'
  | 'EOF'

export interface Token {
  type: TokenType
  value: string
  position: number
}

const KEYWORDS: Record<string, TokenType> = {
  'and': 'AND',
  'or': 'OR',
  'not': 'NOT',
  'xor': 'XOR',
  'implies': 'IMPLIES',
  'true': 'BOOLEAN',
  'false': 'BOOLEAN',
  'if': 'IF',
  'then': 'THEN',
  'else': 'ELSE',
  'endif': 'ENDIF',
  'let': 'LET',
  'in': 'IN_EXPR',
  'self': 'SELF',
}

/**
 * Strip the `ocl{` prefix and `}` suffix from an expression string.
 * If the string does not start with `ocl{`, returns it unchanged (prose).
 */
export function stripOclPrefix(input: string): string {
  const trimmed = input.trimStart()
  if (trimmed.startsWith('ocl{')) {
    // Find the matching closing brace — last `}` in the string
    const inner = trimmed.slice(4) // after 'ocl{'
    const lastBrace = inner.lastIndexOf('}')
    if (lastBrace !== -1) {
      return inner.slice(0, lastBrace)
    }
    return inner
  }
  return input
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let pos = 0

  while (pos < input.length) {
    if (/\s/.test(input[pos])) { pos++; continue }

    if (input[pos] === '[') {
      const start = pos
      // Lookahead: if content is a pure identifier (optional formId:), treat as MEASUREMENT_REF
      // Otherwise, emit LBRACKET and let tokens inside be parsed individually for index access
      const afterBracket = pos + 1
      const closingBracket = input.indexOf(']', afterBracket)
      if (closingBracket !== -1) {
        const inner = input.substring(afterBracket, closingBracket)
        // MEASUREMENT_REF: pure identifier, or form:id, optionally with whitespace
        if (/^[a-zA-Z_]\w*(\s*:\s*[a-zA-Z_]\w*)?$/.test(inner.trim())) {
          pos = closingBracket + 1
          tokens.push({ type: 'MEASUREMENT_REF', value: inner.trim(), position: start })
          continue
        }
      }
      // Not a measurement ref — emit LBRACKET for index access parsing
      tokens.push({ type: 'LBRACKET', value: '[', position: pos })
      pos++
      continue
    }

    // Context variable: $word (e.g., $self, $context, $index, $root, $prev, $form)
    if (input[pos] === '$') {
      const start = pos
      pos++ // skip $
      let value = '$'
      while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) {
        value += input[pos]
        pos++
      }
      tokens.push({ type: 'CONTEXT_VAR', value, position: start })
      continue
    }

    if (input[pos] === '-' && input[pos + 1] === '>') {
      tokens.push({ type: 'ARROW', value: '->', position: pos })
      pos += 2
      continue
    }

    if (input[pos] === '=' && input[pos + 1] === '>') {
      tokens.push({ type: 'FAT_ARROW', value: '=>', position: pos })
      pos += 2
      continue
    }

    const twoChar = input.substring(pos, pos + 2)
    if (twoChar === '<=') { tokens.push({ type: 'LTE', value: '<=', position: pos }); pos += 2; continue }
    if (twoChar === '>=') { tokens.push({ type: 'GTE', value: '>=', position: pos }); pos += 2; continue }
    if (twoChar === '<>') { tokens.push({ type: 'NEQ', value: '<>', position: pos }); pos += 2; continue }
    if (twoChar === '!=') { tokens.push({ type: 'NEQ', value: '!=', position: pos }); pos += 2; continue }

    const ch = input[pos]
    if (ch === '(') { tokens.push({ type: 'LPAREN', value: '(', position: pos }); pos++; continue }
    if (ch === ')') { tokens.push({ type: 'RPAREN', value: ')', position: pos }); pos++; continue }
    if (ch === '{') { tokens.push({ type: 'LBRACKET', value: '{', position: pos }); pos++; continue }
    if (ch === '}') { tokens.push({ type: 'RBRACKET', value: '}', position: pos }); pos++; continue }
    if (ch === ']') { tokens.push({ type: 'RBRACKET', value: ']', position: pos }); pos++; continue }
    if (ch === '.') { tokens.push({ type: 'DOT', value: '.', position: pos }); pos++; continue }
    if (ch === ',') { tokens.push({ type: 'COMMA', value: ',', position: pos }); pos++; continue }
    if (ch === ':') { tokens.push({ type: 'COLON', value: ':', position: pos }); pos++; continue }
    if (ch === ';') { tokens.push({ type: 'SEMICOLON', value: ';', position: pos }); pos++; continue }
    if (ch === '|') { tokens.push({ type: 'PIPE', value: '|', position: pos }); pos++; continue }
    if (ch === '+') { tokens.push({ type: 'PLUS', value: '+', position: pos }); pos++; continue }
    if (ch === '-') { tokens.push({ type: 'MINUS', value: '-', position: pos }); pos++; continue }
    if (ch === '*') { tokens.push({ type: 'STAR', value: '*', position: pos }); pos++; continue }
    if (ch === '/') { tokens.push({ type: 'SLASH', value: '/', position: pos }); pos++; continue }
    if (ch === '%') { tokens.push({ type: 'PERCENT', value: '%', position: pos }); pos++; continue }
    if (ch === '^') { tokens.push({ type: 'CARET', value: '^', position: pos }); pos++; continue }
    if (ch === '<') { tokens.push({ type: 'LT', value: '<', position: pos }); pos++; continue }
    if (ch === '>') { tokens.push({ type: 'GT', value: '>', position: pos }); pos++; continue }
    if (ch === '=') { tokens.push({ type: 'EQ', value: '=', position: pos }); pos++; continue }

    if (ch === "'" || ch === '"') {
      const quote = ch
      const start = pos
      pos++
      let value = ''
      while (pos < input.length && input[pos] !== quote) {
        if (input[pos] === '\\') { pos++; value += input[pos] || ''; }
        else value += input[pos]
        pos++
      }
      pos++
      tokens.push({ type: 'STRING', value, position: start })
      continue
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[pos + 1]))) {
      const start = pos
      let value = ''
      while (pos < input.length && /[0-9.]/.test(input[pos])) { value += input[pos]; pos++ }
      if (pos < input.length && (input[pos] === 'e' || input[pos] === 'E')) {
        value += input[pos]; pos++
        if (pos < input.length && (input[pos] === '+' || input[pos] === '-')) { value += input[pos]; pos++ }
        while (pos < input.length && /[0-9]/.test(input[pos])) { value += input[pos]; pos++ }
      }
      tokens.push({ type: 'NUMBER', value, position: start })
      continue
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const start = pos
      let value = ''
      while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) { value += input[pos]; pos++ }
      const upper = value.toLowerCase()
      const kwType = KEYWORDS[upper]
      if (kwType) {
        tokens.push({ type: kwType, value, position: start })
      } else {
        tokens.push({ type: 'IDENTIFIER', value, position: start })
      }
      continue
    }

    pos++
  }

  tokens.push({ type: 'EOF', value: '', position: pos })
  return tokens
}
