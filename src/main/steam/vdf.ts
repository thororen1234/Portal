export type VdfValue = string | VdfObject

export interface VdfObject {
  [key: string]: VdfValue
}

type Token = { kind: 'open' } | { kind: 'close' } | { kind: 'string'; value: string }

const WHITESPACE = /\s/
const BARE_TERMINATOR = /[\s{}"]/

function* tokenize(source: string): Generator<Token> {
  let i = 0
  const length = source.length
  while (i < length) {
    const char = source[i]
    if (char === '{') {
      i++
      yield { kind: 'open' }
    } else if (char === '}') {
      i++
      yield { kind: 'close' }
    } else if (char === '"') {
      i++
      const parts: string[] = []
      let start = i
      while (i < length && source[i] !== '"') {
        if (source[i] === '\\' && i + 1 < length) {
          parts.push(source.slice(start, i))
          const escaped = source[i + 1]
          parts.push(escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped)
          i += 2
          start = i
        } else {
          i++
        }
      }
      parts.push(source.slice(start, i))
      i++
      yield { kind: 'string', value: parts.join('') }
    } else if (char === '/' && source[i + 1] === '/') {
      while (i < length && source[i] !== '\n') i++
    } else if (char === '[') {
      while (i < length && source[i] !== ']') i++
      i++
    } else if (WHITESPACE.test(char) || char === '﻿') {
      i++
    } else {
      const start = i
      while (i < length && !BARE_TERMINATOR.test(source[i])) i++
      yield { kind: 'string', value: source.slice(start, i) }
    }
  }
}

export function parseVdf(source: string): VdfObject {
  const root: VdfObject = {}
  const stack: VdfObject[] = [root]
  let pendingKey: string | null = null

  for (const token of tokenize(source)) {
    const current = stack[stack.length - 1]
    if (token.kind === 'string') {
      if (pendingKey === null) {
        pendingKey = token.value.toLowerCase()
      } else {
        current[pendingKey] = token.value
        pendingKey = null
      }
    } else if (token.kind === 'open') {
      const key = pendingKey ?? ''
      const existing = current[key]
      const next: VdfObject = typeof existing === 'object' ? existing : {}
      current[key] = next
      stack.push(next)
      pendingKey = null
    } else {
      if (stack.length > 1) stack.pop()
      pendingKey = null
    }
  }

  return root
}

export function child(value: VdfValue | undefined, ...path: string[]): VdfObject | undefined {
  let current = value
  for (const key of path) {
    if (current === undefined || typeof current === 'string') return undefined
    current = current[key.toLowerCase()]
  }
  return typeof current === 'object' ? current : undefined
}

export function text(value: VdfObject | undefined, key: string): string | undefined {
  const entry = value?.[key.toLowerCase()]
  return typeof entry === 'string' ? entry : undefined
}

export function int(value: VdfObject | undefined, key: string): number {
  const parsed = Number(text(value, key))
  return Number.isFinite(parsed) ? parsed : 0
}
