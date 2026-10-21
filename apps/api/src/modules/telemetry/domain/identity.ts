export class IdentityEncodingError extends Error {
  constructor() {
    super('Representación interna de identidad inválida.');
  }
}

// UTF-32 BE interno: conserva también las unidades sustitutas aisladas de JSON.
export function encodeIdentity(value: string): Uint8Array {
  if (value.length === 0) throw new IdentityEncodingError();
  let count = 0;
  const characters = value[Symbol.iterator]();
  while (!characters.next().done) count += 1;
  const bytes = new Uint8Array(count * 4);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const character of value) {
    view.setUint32(offset, character.codePointAt(0)!, false);
    offset += 4;
  }
  return bytes;
}

function* readCodePoints(bytes: Uint8Array): Generator<number> {
  if (bytes.byteLength === 0 || bytes.byteLength % 4 !== 0) throw new IdentityEncodingError();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let previous = -1;
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    const point = view.getUint32(offset, false);
    if (
      point > 0x10ffff ||
      (previous >= 0xd800 && previous <= 0xdbff && point >= 0xdc00 && point <= 0xdfff)
    ) {
      throw new IdentityEncodingError();
    }
    previous = point;
    yield point;
  }
}

export function isCanonicalIdentity(bytes: Uint8Array): boolean {
  try {
    const points = readCodePoints(bytes);
    while (!points.next().done) {
      // Recorrer todos los puntos comprueba el formato sin reconstruir texto.
    }
    return true;
  } catch (error) {
    if (error instanceof IdentityEncodingError) return false;
    throw error;
  }
}

export function decodeIdentity(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let chunk = '';
  for (const point of readCodePoints(bytes)) {
    chunk += String.fromCodePoint(point);
    if (chunk.length >= 4096) {
      chunks.push(chunk);
      chunk = '';
    }
  }
  chunks.push(chunk);
  return chunks.join('');
}

export function compareIdentity(first: string, second: string): -1 | 0 | 1 {
  const left = first[Symbol.iterator]();
  const right = second[Symbol.iterator]();
  for (;;) {
    const a = left.next();
    const b = right.next();
    if (a.done || b.done) return a.done === b.done ? 0 : a.done ? -1 : 1;
    const aPoint = a.value.codePointAt(0)!;
    const bPoint = b.value.codePointAt(0)!;
    if (aPoint !== bPoint) return aPoint < bPoint ? -1 : 1;
  }
}
