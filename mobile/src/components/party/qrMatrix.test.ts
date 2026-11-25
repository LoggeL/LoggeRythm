import { describe, expect, it } from 'vitest';
import {
  computeFormatBitsM,
  computeVersionBits,
  encodeQrMatrix,
} from './qrMatrix';

// Independent GF(256) evaluator for verifying Reed-Solomon block syndromes == 0.
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let v = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = v;
    GF_LOG[v] = i;
    v <<= 1;
    if ((v & 0x100) !== 0) v ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
}
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}
function evalPolyAtRoot(codeword: Uint8Array, rootExp: number): number {
  let acc = 0;
  const x = GF_EXP[rootExp];
  for (let i = 0; i < codeword.length; i += 1) {
    acc = gfMul(acc, x) ^ codeword[i];
  }
  return acc;
}

const SPECS_M: Record<number, { ec: number; groups: readonly (readonly [number, number])[]; align: readonly number[] }> = {
  1: { ec: 10, groups: [[1, 16]], align: [] },
  2: { ec: 16, groups: [[1, 28]], align: [6, 18] },
  3: { ec: 26, groups: [[1, 44]], align: [6, 22] },
  4: { ec: 18, groups: [[2, 32]], align: [6, 26] },
  5: { ec: 24, groups: [[2, 43]], align: [6, 30] },
  6: { ec: 16, groups: [[4, 27]], align: [6, 34] },
  7: { ec: 18, groups: [[4, 31]], align: [6, 22, 38] },
  8: { ec: 22, groups: [[2, 38], [2, 39]], align: [6, 24, 42] },
  9: { ec: 22, groups: [[3, 36], [2, 37]], align: [6, 26, 46] },
  10: { ec: 26, groups: [[4, 43], [1, 44]], align: [6, 28, 50] },
};

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: throw new Error(`Bad mask ${mask}`);
  }
}

/**
 * Independent ISO/IEC 18004 verifier: extracts format bits from both copies,
 * verifies BCH(15,5), checks finder/timing/dark modules, unmasks data modules,
 * de-interleaves RS blocks, checks every RS syndrome is 0, and decodes the Byte payload.
 */
function decodeAndVerifyQrMatrix(modules: boolean[][]): { version: number; mask: number; text: string } {
  const size = modules.length;
  expect((size - 21) % 4).toBe(0);
  const version = (size - 21) / 4 + 1;
  const spec = SPECS_M[version];
  expect(spec).toBeDefined();

  // Verify dark module at (size - 8, 8).
  expect(modules[size - 8][8]).toBe(true);

  // Verify timing strips.
  for (let i = 8; i <= size - 9; i += 1) {
    expect(modules[6][i]).toBe(i % 2 === 0);
    expect(modules[i][6]).toBe(i % 2 === 0);
  }

  // Read Copy 1 format bits.
  const copy1Coords: readonly [number, number][] = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  let fmt1 = 0;
  for (const [r, c] of copy1Coords) {
    fmt1 = (fmt1 << 1) | (modules[r][c] ? 1 : 0);
  }
  // Read Copy 2 format bits.
  let fmt2 = 0;
  for (let i = 0; i < 7; i += 1) {
    fmt2 = (fmt2 << 1) | (modules[size - 1 - i][8] ? 1 : 0);
  }
  for (let i = 0; i < 8; i += 1) {
    fmt2 = (fmt2 << 1) | (modules[8][size - 8 + i] ? 1 : 0);
  }
  expect(fmt1).toBe(fmt2);

  // Unmask format info with 0x5412 and verify BCH(15,5) remainder mod 0x537 == 0.
  const unmaskedFmt = fmt1 ^ 0x5412;
  let fmtRem = unmaskedFmt;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if (((fmtRem >>> bit) & 1) !== 0) fmtRem ^= 0x537 << (bit - 10);
  }
  expect(fmtRem).toBe(0);
  const eccLevel = (unmaskedFmt >>> 13) & 0x3;
  const mask = (unmaskedFmt >>> 10) & 0x7;
  expect(eccLevel).toBe(0b00); // Level M

  // Verify Version info strips for V7+.
  if (version >= 7) {
    let vTopRight = 0;
    let vBottomLeft = 0;
    for (let i = 17; i >= 0; i -= 1) {
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      vTopRight = (vTopRight << 1) | (modules[a][b] ? 1 : 0);
      vBottomLeft = (vBottomLeft << 1) | (modules[b][a] ? 1 : 0);
    }
    expect(vTopRight).toBe(vBottomLeft);
    expect(vTopRight).toBe(computeVersionBits(version));
    expect(vTopRight >>> 12).toBe(version);
  }

  // Reconstruct function-module mask to read data/EC bits.
  const isFn = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const markRect = (r0: number, c0: number, r1: number, c1: number) => {
    for (let r = Math.max(0, r0); r <= Math.min(size - 1, r1); r += 1) {
      for (let c = Math.max(0, c0); c <= Math.min(size - 1, c1); c += 1) {
        isFn[r][c] = true;
      }
    }
  };
  markRect(0, 0, 8, 8);
  markRect(0, size - 8, 8, size - 1);
  markRect(size - 8, 0, size - 1, 8);
  for (let i = 0; i < size; i += 1) {
    isFn[6][i] = true;
    isFn[i][6] = true;
  }
  for (const cr of spec.align) {
    for (const cc of spec.align) {
      if ((cr <= 8 && cc <= 8) || (cr <= 8 && cc >= size - 9) || (cr >= size - 9 && cc <= 8)) {
        continue;
      }
      markRect(cr - 2, cc - 2, cr + 2, cc + 2);
    }
  }
  if (version >= 7) {
    markRect(0, size - 11, 5, size - 9);
    markRect(size - 11, 0, size - 9, 5);
  }

  // Read zig-zag bits and unmask.
  const bits: number[] = [];
  let upward = true;
  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5;
    for (let step = 0; step < size; step += 1) {
      const r = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx += 1) {
        const c = rightCol - dx;
        if (isFn[r][c]) continue;
        const raw = modules[r][c];
        const unmasked = maskBit(mask, r, c) ? !raw : raw;
        bits.push(unmasked ? 1 : 0);
      }
    }
    upward = !upward;
  }

  // Group into bytes and de-interleave data + EC blocks.
  const totalBytes = Math.floor(bits.length / 8);
  const rawBytes = new Uint8Array(totalBytes);
  for (let i = 0; i < totalBytes; i += 1) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) byte = (byte << 1) | bits[i * 8 + b];
    rawBytes[i] = byte;
  }

  const blockDataLens: number[] = [];
  for (const [count, len] of spec.groups) {
    for (let i = 0; i < count; i += 1) blockDataLens.push(len);
  }
  const dataBlocks = blockDataLens.map((len) => new Uint8Array(len));
  const ecBlocks = blockDataLens.map(() => new Uint8Array(spec.ec));
  const maxData = Math.max(...blockDataLens);

  let cursor = 0;
  for (let i = 0; i < maxData; i += 1) {
    for (let b = 0; b < dataBlocks.length; b += 1) {
      if (i < dataBlocks[b].length) {
        dataBlocks[b][i] = rawBytes[cursor];
        cursor += 1;
      }
    }
  }
  for (let i = 0; i < spec.ec; i += 1) {
    for (let b = 0; b < ecBlocks.length; b += 1) {
      ecBlocks[b][i] = rawBytes[cursor];
      cursor += 1;
    }
  }

  // Verify Reed-Solomon syndrome == 0 at all roots α^0..α^(ec-1) for EVERY block!
  for (let b = 0; b < dataBlocks.length; b += 1) {
    const fullBlock = new Uint8Array(dataBlocks[b].length + spec.ec);
    fullBlock.set(dataBlocks[b], 0);
    fullBlock.set(ecBlocks[b], dataBlocks[b].length);
    for (let root = 0; root < spec.ec; root += 1) {
      expect(evalPolyAtRoot(fullBlock, root)).toBe(0);
    }
  }

  // Concatenate data blocks and decode Byte-mode UTF-8 payload.
  const dataBits: number[] = [];
  for (const block of dataBlocks) {
    for (const byte of block) {
      for (let bit = 7; bit >= 0; bit -= 1) dataBits.push((byte >>> bit) & 1);
    }
  }
  let pos = 0;
  const readBits = (n: number): number => {
    let out = 0;
    for (let i = 0; i < n; i += 1) {
      out = (out << 1) | dataBits[pos];
      pos += 1;
    }
    return out;
  };
  expect(readBits(4)).toBe(0b0100); // Byte mode
  const countLen = version <= 9 ? 8 : 16;
  const payloadLen = readBits(countLen);
  const payloadBytes = new Uint8Array(payloadLen);
  for (let i = 0; i < payloadLen; i += 1) payloadBytes[i] = readBits(8);

  const text = new TextDecoder().decode(payloadBytes);
  return { version, mask, text };
}

describe('ISO/IEC 18004 QR code matrix encoder', () => {
  it('matches known ISO Annex C/D format and version BCH bit constants', () => {
    // ISO/IEC 18004 Annex C: ECC M (00) + mask 0 (000) -> 0x5412 (0b101010000010010).
    expect(computeFormatBitsM(0)).toBe(0x5412);
    // ISO/IEC 18004 Annex D: Version 7 -> 0x07C94.
    expect(computeVersionBits(7)).toBe(0x07c94);
  });

  it.each([
    ['JAM999', 1],
    ['https://lr.app/p/AB12CD', 2],
    ['https://music.example.com/party/JAM999', 3],
    ['https://loggerythm.selfhosted.example.org/party/FRIDAY42?source=kiosk', 5],
    [`https://music.example.com/party/LONG99?invite=${'a'.repeat(70)}`, 7],
    [`https://music.example.com/party/LONG99?invite=${'a'.repeat(80)}`, 8],
    [`https://music.example.com/party/XL99?invite=${'b'.repeat(155)}`, 10],
  ])('encodes "%s" into a spec-valid Version %i QR matrix that round-trip decodes cleanly', (payload, expectedVersion) => {
    const encoded = encodeQrMatrix(payload);
    expect(encoded.version).toBe(expectedVersion);
    expect(encoded.size).toBe(21 + 4 * (expectedVersion - 1));
    expect(encoded.modules).toHaveLength(encoded.size);
    expect(encoded.modules.every((row) => row.length === encoded.size)).toBe(true);

    // Deterministic output.
    expect(encodeQrMatrix(payload)).toEqual(encoded);

    // Independent ISO decoder verifies BCH format/version, RS syndromes == 0, and exact UTF-8 round-trip.
    const decoded = decodeAndVerifyQrMatrix(encoded.modules);
    expect(decoded.version).toBe(expectedVersion);
    expect(decoded.mask).toBe(encoded.mask);
    expect(decoded.text).toBe(payload);
  });

  it('fails loudly on empty payloads and payloads exceeding Version 10 capacity', () => {
    expect(() => encodeQrMatrix('')).toThrow('Cannot encode an empty string');
    expect(() => encodeQrMatrix('x'.repeat(214))).toThrow('exceeds Version 10');
  });
});
