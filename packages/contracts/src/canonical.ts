/**
 * RFC 8785 (JSON Canonicalization Scheme) canonicalization over I-JSON values
 * and strict JSON text.
 *
 * Two entry points exist because two failure seams exist:
 *
 * - {@link canonicalizeJsonValue} canonicalizes an already-parsed value. It
 *   rejects non-I-JSON values that JSON text cannot express (undefined, sparse
 *   arrays, non-finite numbers, BigInt, symbols, cycles, class instances).
 * - {@link canonicalizeJsonText} parses raw text with a strict parser that
 *   additionally rejects duplicate object keys at the text seam, which a
 *   plain `JSON.parse` silently collapses.
 *
 * Both produce the same canonical bytes for the same logical value. Sorting is
 * by UTF-16 code unit order (RFC 8785), array order is preserved, Unicode is
 * preserved exactly (no normalization), and output is UTF-8 with no
 * whitespace.
 */
import canonicalize from "canonicalize";
import { TextDecoder, TextEncoder } from "node:util";

import type { JsonValue } from "./result.js";
import { err, ok, type Result } from "./result.js";

/** Error codes emitted by the canonicalization layer. */
export type CanonicalErrorCode =
  | "NOT_JSON_TEXT"
  | "DUPLICATE_OBJECT_KEY"
  | "NON_IJSON_VALUE";

/** A canonicalization failure. `path` locates the offending value when known. */
export interface CanonicalError {
  code: CanonicalErrorCode;
  message: string;
  path?: string;
  position?: number;
}

function fail(code: CanonicalErrorCode, message: string): CanonicalError {
  return { code, message };
}

const textEncoder = new TextEncoder();

/**
 * Canonicalize an in-memory value, rejecting anything that is not I-JSON.
 * The result is the RFC 8785 canonical serialization as UTF-8 bytes.
 */
export function canonicalizeJsonValue(
  value: JsonValue,
): Result<Uint8Array, CanonicalError> {
  const problem = assertJsonCompatible(value, "$", new Set<object>());
  if (problem !== null) {
    return err(problem);
  }
  let serialized: string | undefined;
  try {
    serialized = canonicalize(value);
  } catch {
    return err(
      fail("NON_IJSON_VALUE", "value cannot be serialized as canonical JSON"),
    );
  }
  if (serialized === undefined) {
    return err(fail("NON_IJSON_VALUE", "value is not a canonicalizable JSON value"));
  }
  return ok(textEncoder.encode(serialized));
}

/** Canonical serialization of an in-memory value as a string. */
export function canonicalizeJsonValueString(
  value: JsonValue,
): Result<string, CanonicalError> {
  const result = canonicalizeJsonValue(value);
  if (!result.ok) {
    return result;
  }
  return ok(textDecoder.decode(result.value));
}

const textDecoder = new TextDecoder();

/**
 * Parse raw JSON text with a strict recursive-descent parser that rejects
 * duplicate object keys and non-JSON syntax, then canonicalize it.
 *
 * Unlike `JSON.parse`, this never collapses duplicate keys and never returns a
 * non-finite number for a too-large exponent (`1e400` becomes a
 * `NOT_JSON_TEXT` failure).
 */
export function canonicalizeJsonText(
  text: string,
): Result<Uint8Array, CanonicalError> {
  const parsed = parseJsonTextStrict(text);
  if (!parsed.ok) {
    return parsed;
  }
  return canonicalizeJsonValue(parsed.value);
}

/**
 * Parse raw JSON text into an I-JSON value, rejecting duplicate object keys.
 * This is the "raw-text parse seam": it detects duplicate keys that disappear
 * when a value is re-serialized.
 */
export function parseJsonTextStrict(
  text: string,
): Result<JsonValue, CanonicalError> {
  const parser = new StrictJsonParser(text);
  const value = parser.parse();
  if (value instanceof ParseFailure) {
    return err({ code: value.code, message: value.message, position: value.position });
  }
  const problem = assertJsonCompatible(value, "$", new Set<object>());
  if (problem !== null) {
    return err(problem);
  }
  return ok(value);
}

class ParseFailure {
  constructor(
    public readonly code: "NOT_JSON_TEXT" | "DUPLICATE_OBJECT_KEY",
    public readonly message: string,
    public readonly position: number,
  ) {}
}

/**
 * A small strict JSON parser. It enforces the JSON grammar, rejects duplicate
 * object keys, and rejects numbers that round to Infinity. It does not accept
 * trailing commas, comments, single quotes, unquoted keys, or NaN/Infinity
 * literals.
 */
class StrictJsonParser {
  private i = 0;

  constructor(private readonly text: string) {}

  parse(): JsonValue | ParseFailure {
    const value = this.parseValue();
    if (value instanceof ParseFailure) {
      return value;
    }
    this.skipWhitespace();
    if (this.i !== this.text.length) {
      return this.error("NOT_JSON_TEXT", "unexpected trailing content");
    }
    return value;
  }

  private error(
    code: "NOT_JSON_TEXT" | "DUPLICATE_OBJECT_KEY",
    message: string,
  ): ParseFailure {
    return new ParseFailure(code, message, this.i);
  }

  private skipWhitespace(): void {
    while (this.i < this.text.length) {
      const ch = this.text.charCodeAt(this.i);
      if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
        this.i += 1;
      } else {
        return;
      }
    }
  }

  private peek(): number {
    return this.text.charCodeAt(this.i);
  }

  private parseValue(): JsonValue | ParseFailure {
    this.skipWhitespace();
    if (this.i >= this.text.length) {
      return this.error("NOT_JSON_TEXT", "unexpected end of input");
    }
    const ch = this.text[this.i];
    switch (ch) {
      case "{":
        return this.parseObject();
      case "[":
        return this.parseArray();
      case '"':
        return this.parseString();
      case "t":
        return this.parseLiteral("true", true);
      case "f":
        return this.parseLiteral("false", false);
      case "n":
        return this.parseLiteral("null", null);
      default:
        if (ch === "-" || (ch !== undefined && ch >= "0" && ch <= "9")) {
          return this.parseNumber();
        }
        return this.error("NOT_JSON_TEXT", `unexpected character ${JSON.stringify(ch)}`);
    }
  }

  private parseLiteral(literal: string, value: JsonValue): JsonValue | ParseFailure {
    if (this.text.startsWith(literal, this.i)) {
      this.i += literal.length;
      return value;
    }
    return this.error("NOT_JSON_TEXT", `invalid literal, expected ${literal}`);
  }

  private parseObject(): JsonValue | ParseFailure {
    this.i += 1; // consume '{'
    const object: { [key: string]: JsonValue } = {};
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.peek() === 0x7d) {
      this.i += 1;
      return object;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.peek() !== 0x22) {
        return this.error("NOT_JSON_TEXT", "expected a string key in object");
      }
      const key = this.parseString();
      if (key instanceof ParseFailure) {
        return key;
      }
      if (typeof key !== "string") {
        return this.error("NOT_JSON_TEXT", "object key must be a string");
      }
      if (keys.has(key)) {
        return this.error("DUPLICATE_OBJECT_KEY", `duplicate object key ${JSON.stringify(key)}`);
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.peek() !== 0x3a) {
        return this.error("NOT_JSON_TEXT", "expected ':' after object key");
      }
      this.i += 1;
      const value = this.parseValue();
      if (value instanceof ParseFailure) {
        return value;
      }
      Object.defineProperty(object, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      this.skipWhitespace();
      const ch = this.peek();
      if (ch === 0x2c) {
        this.i += 1;
        continue;
      }
      if (ch === 0x7d) {
        this.i += 1;
        return object;
      }
      return this.error("NOT_JSON_TEXT", "expected ',' or '}' in object");
    }
  }

  private parseArray(): JsonValue | ParseFailure {
    this.i += 1; // consume '['
    const array: JsonValue[] = [];
    this.skipWhitespace();
    if (this.peek() === 0x5d) {
      this.i += 1;
      return array;
    }
    for (;;) {
      const value = this.parseValue();
      if (value instanceof ParseFailure) {
        return value;
      }
      array.push(value);
      this.skipWhitespace();
      const ch = this.peek();
      if (ch === 0x2c) {
        this.i += 1;
        continue;
      }
      if (ch === 0x5d) {
        this.i += 1;
        return array;
      }
      return this.error("NOT_JSON_TEXT", "expected ',' or ']' in array");
    }
  }

  private parseString(): string | ParseFailure {
    this.i += 1; // consume opening '"'
    let out = "";
    for (;;) {
      if (this.i >= this.text.length) {
        return this.error("NOT_JSON_TEXT", "unterminated string");
      }
      const ch = this.text[this.i];
      const code = this.text.charCodeAt(this.i);
      if (code === 0x22) {
        this.i += 1;
        return out;
      }
      if (code < 0x20) {
        return this.error("NOT_JSON_TEXT", "unescaped control character in string");
      }
      if (ch === "\\") {
        this.i += 1;
        if (this.i >= this.text.length) {
          return this.error("NOT_JSON_TEXT", "unterminated escape sequence");
        }
        const esc = this.text[this.i];
        switch (esc) {
          case '"':
            out += '"';
            break;
          case "\\":
            out += "\\";
            break;
          case "/":
            out += "/";
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "\t";
            break;
          case "u": {
            const hex = this.text.slice(this.i + 1, this.i + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              return this.error("NOT_JSON_TEXT", "invalid \\u escape");
            }
            out += String.fromCharCode(parseInt(hex, 16));
            this.i += 4;
            break;
          }
          default:
            return this.error("NOT_JSON_TEXT", `invalid escape character ${JSON.stringify(esc)}`);
        }
        this.i += 1;
        continue;
      }
      out += ch;
      this.i += 1;
    }
  }

  private parseNumber(): JsonValue | ParseFailure {
    const start = this.i;
    if (this.peek() === 0x2d) {
      this.i += 1;
    }
    if (this.peek() === 0x30) {
      this.i += 1;
    } else if (this.peek() >= 0x31 && this.peek() <= 0x39) {
      while (this.peek() >= 0x30 && this.peek() <= 0x39) {
        this.i += 1;
      }
    } else {
      return this.error("NOT_JSON_TEXT", "invalid number");
    }
    if (this.peek() === 0x2e) {
      this.i += 1;
      if (!(this.peek() >= 0x30 && this.peek() <= 0x39)) {
        return this.error("NOT_JSON_TEXT", "expected digit after decimal point");
      }
      while (this.peek() >= 0x30 && this.peek() <= 0x39) {
        this.i += 1;
      }
    }
    if (this.peek() === 0x65 || this.peek() === 0x45) {
      this.i += 1;
      if (this.peek() === 0x2b || this.peek() === 0x2d) {
        this.i += 1;
      }
      if (!(this.peek() >= 0x30 && this.peek() <= 0x39)) {
        return this.error("NOT_JSON_TEXT", "expected digit in exponent");
      }
      while (this.peek() >= 0x30 && this.peek() <= 0x39) {
        this.i += 1;
      }
    }
    const raw = this.text.slice(start, this.i);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return this.error("NOT_JSON_TEXT", `number ${raw} is not finite`);
    }
    return value;
  }
}

/**
 * Recursively verify that a value is I-JSON and free of JavaScript-only
 * values. Returns a `CanonicalError` on the first problem or null when valid.
 */
function assertJsonCompatible(
  value: unknown,
  path: string,
  seen: Set<object>,
): CanonicalError | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    const surrogate = firstUnpairedSurrogate(value);
    if (surrogate !== null) {
      return {
        code: "NON_IJSON_VALUE",
        message: `unpaired Unicode surrogate at ${path}[${surrogate}]`,
        path,
      };
    }
    return null;
  }
  if (typeof value === "boolean") {
    return null;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return null;
    }
    return {
      code: "NON_IJSON_VALUE",
      message: `non-finite number at ${path}`,
      path,
    };
  }
  if (
    typeof value === "bigint" ||
    typeof value === "undefined" ||
    typeof value === "symbol" ||
    typeof value === "function"
  ) {
    return {
      code: "NON_IJSON_VALUE",
      message: `non-JSON ${typeof value} value at ${path}`,
      path,
    };
  }

  // typeof value is now "object".
  if (seen.has(value)) {
    return { code: "NON_IJSON_VALUE", message: `circular reference at ${path}`, path };
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, i)) {
          return {
            code: "NON_IJSON_VALUE",
            message: `sparse array hole at ${path}[${i}]`,
            path: `${path}[${i}]`,
          };
        }
        const problem = assertJsonCompatible(value[i], `${path}[${i}]`, seen);
        if (problem !== null) {
          return problem;
        }
      }
      for (const key of Object.keys(value)) {
        if (!/^(0|[1-9]\d*)$/.test(key)) {
          return {
            code: "NON_IJSON_VALUE",
            message: `array with named property ${JSON.stringify(key)} at ${path}`,
            path: `${path}.${key}`,
          };
        }
      }
      return null;
    }

    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return {
        code: "NON_IJSON_VALUE",
        message: `non-plain object at ${path}`,
        path,
      };
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return {
        code: "NON_IJSON_VALUE",
        message: `object with symbol key at ${path}`,
        path,
      };
    }
    for (const key of Object.keys(value)) {
      const surrogate = firstUnpairedSurrogate(key);
      if (surrogate !== null) {
        return {
          code: "NON_IJSON_VALUE",
          message: `object key has an unpaired Unicode surrogate at ${path}`,
          path,
        };
      }
      const problem = assertJsonCompatible(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
        seen,
      );
      if (problem !== null) {
        return problem;
      }
    }
    return null;
  } finally {
    seen.delete(value);
  }
}

/** Return the first unpaired UTF-16 surrogate, or null for valid Unicode. */
function firstUnpairedSurrogate(value: string): number | null {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return index;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return index;
    }
  }
  return null;
}
