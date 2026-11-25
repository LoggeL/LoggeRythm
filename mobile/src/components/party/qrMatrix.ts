/**
 * Pure TypeScript ISO/IEC 18004 QR Code encoder (Versions 1–10, Byte mode,
 * Error Correction Level M, all 8 ISO masks with standard penalty scoring).
 * Zero native or external dependencies; produces real camera-scannable QR matrices.
 */

export interface QrMatrixResult {
  /** QR version (1..10). */
  version: number;
  /** Symbol width/height in modules (21 + 4 * (version - 1)), excluding quiet zone. */
  size: number;
  /** Selected ISO mask pattern (0..7). */
  mask: number;
  /** Square boolean matrix of length `size × size` (`true` = dark module). */
  modules: boolean[][];
}

interface VersionSpec {
  version: number;
  ecPerBlock: number;
  /** [blockCount, dataCodewordsPerBlock] pairs for Group 1 and optional Group 2. */
  groups: readonly (readonly [number, number])[];
  alignmentCenters: readonly number[];
}

// ISO/IEC 18004 Table 9 (Error Correction Level M) & Annex E (Alignment centers).
const VERSION_SPECS_M: readonly VersionSpec[] = [
  { version: 1, ecPerBlock: 10, groups: [[1, 16]], alignmentCenters: [] },
  { version: 2, ecPerBlock: 16, groups: [[1, 28]], alignmentCenters: [6, 18] },
  { version: 3, ecPerBlock: 26, groups: [[1, 44]], alignmentCenters: [6, 22] },
  { version: 4, ecPerBlock: 18, groups: [[2, 32]], alignmentCenters: [6, 26] },
  { version: 5, ecPerBlock: 24, groups: [[2, 43]], alignmentCenters: [6, 30] },
  { version: 6, ecPerBlock: 16, groups: [[4, 27]], alignmentCenters: [6, 34] },
  { version: 7, ecPerBlock: 18, groups: [[4, 31]], alignmentCenters: [6, 22, 38] },
  { version: 8, ecPerBlock: 22, groups: [[2, 38], [2, 39]], alignmentCenters: [6, 24, 42] },
  { version: 9, ecPerBlock: 22, groups: [[3, 36], [2, 37]], alignmentCenters: [6, 26, 46] },
  { version: 10, ecPerBlock: 26, groups: [[4, 43], [1, 44]], alignmentCenters: [6, 28, 50] },
];

// GF(256) with QR primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d).
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = value;
    GF_LOG[value] = i;
    value <<= 1;
    if ((value & 0x100) !== 0) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function reedSolomonGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function reedSolomonRemainder(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = reedSolomonGenerator(ecCount);
  const rem = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i += 1) {
    const factor = data[i] ^ rem[0];
    for (let j = 0; j < ecCount - 1; j += 1) {
      rem[j] = rem[j + 1];
    }
    rem[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j += 1) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

/** Pure-TS UTF-8 encoder (works identically across Hermes, JSC, and Node). */
export function encodeUtf8Bytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let codePoint = text.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function totalDataCodewords(spec: VersionSpec): number {
  let total = 0;
  for (const [count, perBlock] of spec.groups) {
    total += count * perBlock;
  }
  return total;
}

function byteCountBitsForVersion(version: number): number {
  return version <= 9 ? 8 : 16;
}

function selectVersionSpec(byteLength: number): VersionSpec {
  for (const spec of VERSION_SPECS_M) {
    const capacityBits = totalDataCodewords(spec) * 8;
    const requiredBits = 4 + byteCountBitsForVersion(spec.version) + byteLength * 8;
    if (requiredBits <= capacityBits) return spec;
  }
  throw new Error(
    `QR payload length (${byteLength} UTF-8 bytes) exceeds Version 10 ECC-M capacity`,
  );
}

function buildDataCodewords(payload: Uint8Array, spec: VersionSpec): Uint8Array {
  const totalBytes = totalDataCodewords(spec);
  const totalBits = totalBytes * 8;
  const bits: number[] = [];
  const pushBits = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) {
      bits.push((value >>> i) & 1);
    }
  };

  // Byte mode indicator (0100) + character count indicator.
  pushBits(0b0100, 4);
  pushBits(payload.length, byteCountBitsForVersion(spec.version));
  for (let i = 0; i < payload.length; i += 1) {
    pushBits(payload[i], 8);
  }

  // Up to 4 zero terminator bits, then pad to next byte boundary.
  const terminator = Math.min(4, totalBits - bits.length);
  for (let i = 0; i < terminator; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const out = new Uint8Array(totalBytes);
  const byteLen = bits.length / 8;
  for (let i = 0; i < byteLen; i += 1) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) {
      byte = (byte << 1) | bits[i * 8 + b];
    }
    out[i] = byte;
  }

  // ISO alternating pad codewords 0xEC, 0x11.
  let padToggle = true;
  for (let i = byteLen; i < totalBytes; i += 1) {
    out[i] = padToggle ? 0xec : 0x11;
    padToggle = !padToggle;
  }
  return out;
}

function interleaveCodewords(data: Uint8Array, spec: VersionSpec): Uint8Array {
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  let maxDataLen = 0;

  for (const [count, perBlock] of spec.groups) {
    maxDataLen = Math.max(maxDataLen, perBlock);
    for (let i = 0; i < count; i += 1) {
      const slice = data.subarray(offset, offset + perBlock);
      offset += perBlock;
      dataBlocks.push(slice);
      ecBlocks.push(reedSolomonRemainder(slice, spec.ecPerBlock));
    }
  }

  const totalBlocks = dataBlocks.length;
  const interleaved = new Uint8Array(data.length + totalBlocks * spec.ecPerBlock);
  let cursor = 0;
  for (let i = 0; i < maxDataLen; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) {
        interleaved[cursor] = block[i];
        cursor += 1;
      }
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const ec of ecBlocks) {
      interleaved[cursor] = ec[i];
      cursor += 1;
    }
  }
  return interleaved;
}

/** Compute the 15-bit BCH(15,5) format string for ECC Level M (`00`) + mask (0..7). */
export function computeFormatBitsM(mask: number): number {
  const data = (0b00 << 3) | (mask & 0x7);
  let rem = data << 10;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if (((rem >>> bit) & 1) !== 0) {
      rem ^= 0x537 << (bit - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

/** Compute the 18-bit BCH(18,6) version information for Version >= 7. */
export function computeVersionBits(version: number): number {
  let rem = version << 12;
  for (let bit = 17; bit >= 12; bit -= 1) {
    if (((rem >>> bit) & 1) !== 0) {
      rem ^= 0x1f25 << (bit - 12);
    }
  }
  return (version << 12) | rem;
}

function maskCondition(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      throw new Error(`Invalid QR mask pattern: ${mask}`);
  }
}

function buildFunctionTemplate(spec: VersionSpec): {
  size: number;
  modules: boolean[][];
  isFunction: boolean[][];
} {
  const size = 21 + 4 * (spec.version - 1);
  const modules = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => Array<boolean>(size).fill(false));

  const setFn = (row: number, col: number, dark: boolean) => {
    if (row < 0 || row >= size || col < 0 || col >= size) return;
    modules[row][col] = dark;
    isFunction[row][col] = true;
  };

  // Three 7×7 finder patterns + 1-module white separators.
  const placeFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const border = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const center = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFn(top + dr, left + dc, inside && (border || center));
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns on row 6 and column 6.
  for (let i = 8; i <= size - 9; i += 1) {
    const dark = i % 2 === 0;
    setFn(6, i, dark);
    setFn(i, 6, dark);
  }

  // 5×5 alignment patterns (skipping centers overlapping finder patterns).
  const centers = spec.alignmentCenters;
  for (const cr of centers) {
    for (const cc of centers) {
      const overlapsTopLeft = cr <= 8 && cc <= 8;
      const overlapsTopRight = cr <= 8 && cc >= size - 9;
      const overlapsBottomLeft = cr >= size - 9 && cc <= 8;
      if (overlapsTopLeft || overlapsTopRight || overlapsBottomLeft) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFn(cr + dr, cc + dc, dist === 0 || dist === 2);
        }
      }
    }
  }

  // Reserve format info coordinates + dark module at (size - 8, 8).
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      setFn(8, i, false);
      setFn(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    setFn(8, size - 1 - i, false);
  }
  for (let i = 0; i < 7; i += 1) {
    setFn(size - 1 - i, 8, false);
  }
  setFn(size - 8, 8, true);

  // Version information strips for Version >= 7.
  if (spec.version >= 7) {
    const versionBits = computeVersionBits(spec.version);
    for (let i = 0; i < 18; i += 1) {
      const dark = ((versionBits >>> i) & 1) !== 0;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFn(a, b, dark);
      setFn(b, a, dark);
    }
  }

  return { size, modules, isFunction };
}

function writeFormatInfo(modules: boolean[][], size: number, mask: number): void {
  const bits = computeFormatBitsM(mask);
  const bitAt = (index: number) => ((bits >>> index) & 1) !== 0;

  // Copy 1 around top-left finder (bits 14..0).
  const copy1Coords: readonly [number, number][] = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i += 1) {
    const [r, c] = copy1Coords[i];
    modules[r][c] = bitAt(14 - i);
  }

  // Copy 2: bottom-left vertical (bits 14..8) + top-right horizontal (bits 7..0).
  for (let i = 0; i < 7; i += 1) {
    modules[size - 1 - i][8] = bitAt(14 - i);
  }
  for (let i = 0; i < 8; i += 1) {
    modules[8][size - 8 + i] = bitAt(7 - i);
  }
}

function placeCodewords(
  modules: boolean[][],
  isFunction: boolean[][],
  size: number,
  codewords: Uint8Array,
): void {
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx += 1) {
        const col = rightCol - dx;
        if (isFunction[row][col]) continue;
        let dark = false;
        if (bitIndex < totalBits) {
          const byte = codewords[bitIndex >>> 3];
          dark = ((byte >>> (7 - (bitIndex & 7))) & 1) !== 0;
          bitIndex += 1;
        }
        modules[row][col] = dark;
      }
    }
    upward = !upward;
  }
}

function scoreMaskPenalty(modules: boolean[][], size: number): number {
  let penalty = 0;

  // Rule 1: adjacent modules in row/column in same color (5+ -> 3 + extra).
  for (let r = 0; r < size; r += 1) {
    let runColor = modules[r][0];
    let runLen = 1;
    for (let c = 1; c < size; c += 1) {
      if (modules[r][c] === runColor) {
        runLen += 1;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let c = 0; c < size; c += 1) {
    let runColor = modules[0][c];
    let runLen = 1;
    for (let r = 1; r < size; r += 1) {
      if (modules[r][c] === runColor) {
        runLen += 1;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // Rule 2: 2×2 blocks of same color (+3 each).
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = modules[r][c];
      if (modules[r][c + 1] === v && modules[r + 1][c] === v && modules[r + 1][c + 1] === v) {
        penalty += 3;
      }
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 with 4 light modules on either side (+40 each).
  const p1 = [true, false, true, true, true, false, true, false, false, false, false];
  const p2 = [false, false, false, false, true, false, true, true, true, false, true];
  const matchesAt = (get: (idx: number) => boolean, pattern: readonly boolean[]): boolean => {
    for (let i = 0; i < 11; i += 1) {
      if (get(i) !== pattern[i]) return false;
    }
    return true;
  };
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c <= size - 11; c += 1) {
      if (
        matchesAt((i) => modules[r][c + i], p1)
        || matchesAt((i) => modules[r][c + i], p2)
      ) {
        penalty += 40;
      }
    }
  }
  for (let c = 0; c < size; c += 1) {
    for (let r = 0; r <= size - 11; r += 1) {
      if (
        matchesAt((i) => modules[r + i][c], p1)
        || matchesAt((i) => modules[r + i][c], p2)
      ) {
        penalty += 40;
      }
    }
  }

  // Rule 4: dark module balance relative to 50%.
  let darkCount = 0;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (modules[r][c]) darkCount += 1;
    }
  }
  const percent = (darkCount * 100) / (size * size);
  const prevFive = Math.floor(percent / 5) * 5;
  const nextFive = prevFive + 5;
  const deviation = Math.min(Math.abs(prevFive - 50), Math.abs(nextFive - 50)) / 5;
  penalty += deviation * 10;

  return penalty;
}

/**
 * Encode `text` into a real ISO/IEC 18004 QR Code matrix (Byte mode, ECC Level M).
 * Throws explicitly if `text` is empty or exceeds Version 10 capacity (213 UTF-8 bytes).
 */
export function encodeQrMatrix(text: string): QrMatrixResult {
  if (text.length === 0) {
    throw new Error('Cannot encode an empty string as a QR code');
  }
  const payload = encodeUtf8Bytes(text);
  const spec = selectVersionSpec(payload.length);
  const dataCodewords = buildDataCodewords(payload, spec);
  const finalCodewords = interleaveCodewords(dataCodewords, spec);

  const template = buildFunctionTemplate(spec);
  placeCodewords(template.modules, template.isFunction, template.size, finalCodewords);

  let bestMask = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  let bestModules: boolean[][] | null = null;

  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = template.modules.map((row, r) =>
      row.map((val, c) =>
        template.isFunction[r][c] ? val : maskCondition(mask, r, c) ? !val : val,
      ),
    );
    writeFormatInfo(candidate, template.size, mask);
    const penalty = scoreMaskPenalty(candidate, template.size);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestModules = candidate;
    }
  }

  if (bestModules === null) {
    throw new Error('QR mask selection failed to produce a candidate matrix');
  }

  return {
    version: spec.version,
    size: template.size,
    mask: bestMask,
    modules: bestModules,
  };
}
