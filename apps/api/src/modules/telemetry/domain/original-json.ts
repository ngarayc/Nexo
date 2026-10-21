import { parseTree } from 'jsonc-parser';
import type { Node as JsonNode, NodeType, ParseError } from 'jsonc-parser';

export class InvalidJsonError extends Error {
  constructor() {
    super('Documento JSON inválido.');
  }
}

type JsonKind = Exclude<NodeType, 'property'>;

function properties(node: JsonNode): { key: string; value: JsonNode; property: JsonNode }[] {
  if (node.type !== 'object') throw new Error('Se esperaba un objeto JSON interno.');
  return (node.children ?? []).map((property) => {
    const key: unknown = property.children?.[0]?.value;
    const value = property.children?.[1];
    if (typeof key !== 'string' || !value) throw new Error('Árbol JSON interno inconsistente.');
    return { key, value, property };
  });
}

function decimal(raw: string): { negative: boolean; coefficient: string; exponent: bigint } {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) throw new Error('Token numérico interno inválido.');
  const integer = match[2]!;
  const fraction = match[3] ?? '';
  const digits = (integer + fraction).replace(/^0+/, '');
  if (!digits) return { negative: false, coefficient: '', exponent: 0n };
  const coefficient = digits.replace(/0+$/, '');
  const exponent =
    BigInt(match[4] ?? '0') - BigInt(fraction.length) + BigInt(digits.length - coefficient.length);
  return { negative: match[1] === '-', coefficient, exponent };
}

function equalNodes(
  first: JsonNode,
  firstSource: string,
  second: JsonNode,
  secondSource: string,
): boolean {
  const pending: [JsonNode, JsonNode][] = [[first, second]];
  for (let pair = pending.pop(); pair; pair = pending.pop()) {
    const [a, b] = pair;
    if (a.type !== b.type) return false;
    switch (a.type) {
      case 'null':
        break;
      case 'boolean':
      case 'string':
        if (a.value !== b.value) return false;
        break;
      case 'number': {
        const left = decimal(firstSource.slice(a.offset, a.offset + a.length));
        const right = decimal(secondSource.slice(b.offset, b.offset + b.length));
        if (
          left.negative !== right.negative ||
          left.coefficient !== right.coefficient ||
          left.exponent !== right.exponent
        )
          return false;
        break;
      }
      case 'array': {
        const left = a.children ?? [];
        const right = b.children ?? [];
        if (left.length !== right.length) return false;
        for (let index = 0; index < left.length; index += 1)
          pending.push([left[index]!, right[index]!]);
        break;
      }
      case 'object': {
        // Igual que JSON.parse, la última aparición de una clave es su valor.
        // Map mantiene __proto__/constructor como datos y no cambia prototipos.
        const left = new Map(properties(a).map((entry) => [entry.key, entry.value]));
        const right = new Map(properties(b).map((entry) => [entry.key, entry.value]));
        if (left.size !== right.size) return false;
        for (const [key, value] of left) {
          const other = right.get(key);
          if (!other) return false;
          pending.push([value, other]);
        }
        break;
      }
      default:
        throw new Error('Tipo de nodo JSON interno inválido.');
    }
  }
  return true;
}

export class OriginalJson {
  private constructor(
    private readonly source: string,
    private readonly node: JsonNode,
    private readonly wholeDocument = false,
  ) {
    Object.freeze(this);
  }

  static parse(source: string): OriginalJson {
    const errors: ParseError[] = [];
    const node = parseTree(source, errors, {
      disallowComments: true,
      allowTrailingComma: false,
      allowEmptyContent: false,
    });
    if (!node || errors.length !== 0) throw new InvalidJsonError();
    return new OriginalJson(source, node, true);
  }

  get kind(): JsonKind {
    if (this.node.type === 'property') throw new Error('Tipo de nodo JSON interno inválido.');
    return this.node.type;
  }

  get raw(): string {
    return this.wholeDocument
      ? this.source
      : this.source.slice(this.node.offset, this.node.offset + this.node.length);
  }
  get arrayLength(): number | undefined {
    return this.kind === 'array' ? (this.node.children?.length ?? 0) : undefined;
  }
  get stringValue(): string | undefined {
    const value: unknown = this.node.value;
    return this.kind === 'string' && typeof value === 'string' ? value : undefined;
  }
  get numberValue(): number | undefined {
    return this.kind === 'number' ? Number(this.raw) : undefined;
  }
  get booleanValue(): boolean | undefined {
    const value: unknown = this.node.value;
    return this.kind === 'boolean' && typeof value === 'boolean' ? value : undefined;
  }

  property(name: string): OriginalJson | undefined {
    if (this.kind !== 'object') return;
    let selected: JsonNode | undefined;
    for (const entry of properties(this.node)) if (entry.key === name) selected = entry.value;
    return selected ? new OriginalJson(this.source, selected) : undefined;
  }

  elements(): readonly OriginalJson[] | undefined {
    if (this.kind !== 'array') return;
    return Object.freeze(
      (this.node.children ?? []).map((node) => new OriginalJson(this.source, node)),
    );
  }

  withoutProperties(names: ReadonlySet<string>): OriginalJson {
    const fragments = properties(this.node)
      .filter((entry) => !names.has(entry.key))
      .map((entry) =>
        this.source.slice(entry.property.offset, entry.property.offset + entry.property.length),
      );
    return OriginalJson.parse(`{${fragments.join(',')}}`);
  }

  equals(other: OriginalJson): boolean {
    return equalNodes(this.node, this.source, other.node, other.source);
  }
}
