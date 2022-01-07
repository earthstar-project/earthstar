/*! noble-ed25519 - MIT License (c) Paul Miller (paulmillr.com) */
// Thanks DJB https://ed25519.cr.yp.to
// https://tools.ietf.org/html/rfc8032, https://en.wikipedia.org/wiki/EdDSA
// Includes Ristretto https://ristretto.group

// TODO: we're using node crypto to avoid a crash that comes from using Deno's main crypto module
import * as nodeCrypto from 'https://deno.land/std@0.119.0/node/crypto.ts';

// Be friendly to bad ECMAScript parsers by not using bigint literals like 123n
const _0n = BigInt(0);
const _1n = BigInt(1);
const _2n = BigInt(2);
const _255n = BigInt(255);

// Curve formula is −x² + y² = 1 − (121665/121666) * x² * y²
const CURVE = {
  // Params: a, b
  a: BigInt(-1),
  // Equal to -121665/121666 over finite field.
  // Negative number is P - number, and division is invert(number, P)
  d: BigInt('37095705934669439343138083508754565189542113879843219016388785533085940283555'),
  // Finite field 𝔽p over which we'll do calculations
  P: _2n ** _255n - BigInt(19),
  // Subgroup order aka C
  n: _2n ** BigInt(252) + BigInt('27742317777372353535851937790883648493'),
  // Cofactor
  h: BigInt(8),
  // Base point (x, y) aka generator point
  Gx: BigInt('15112221349535400772501151409588531511454012693041857206046113283949847762202'),
  Gy: BigInt('46316835694926478169428394003475163141307993866256225615783033603165251855960'),
};

// Cleaner output this way.
export { CURVE };

type Hex = Uint8Array | string;
type PrivKey = Hex | bigint | number;
type PubKey = Hex | Point;
type SigType = Hex | Signature;
const B32 = 32;

// √(-1) aka √(a) aka 2^((p-1)/4)
const SQRT_M1 = BigInt(
  '19681161376707505956807079304988542015446066515923890162744021073123829784752'
);
// √(ad - 1)
const SQRT_AD_MINUS_ONE = BigInt(
  '25063068953384623474111414158702152701244531502492656460079210482610430750235'
);
// 1 / √(a-d)
const INVSQRT_A_MINUS_D = BigInt(
  '54469307008909316920995813868745141605393597292927456921205312896311721017578'
);
// 1-d²
const ONE_MINUS_D_SQ = BigInt(
  '1159843021668779879193775521855586647937357759715417654439879720876111806838'
);
// (d-1)²
const D_MINUS_ONE_SQ = BigInt(
  '40440834346308536858101042469323190826248399146238708352240133220865137265952'
);

// Default Point works in default aka affine coordinates: (x, y)
// Extended Point works in extended coordinates: (x, y, z, t) ∋ (x=x/z, y=y/z, t=xy)
// https://en.wikipedia.org/wiki/Twisted_Edwards_curve#Extended_coordinates
class ExtendedPoint {
  constructor(readonly x: bigint, readonly y: bigint, readonly z: bigint, readonly t: bigint) {}

  static BASE = new ExtendedPoint(CURVE.Gx, CURVE.Gy, _1n, mod(CURVE.Gx * CURVE.Gy));
  static ZERO = new ExtendedPoint(_0n, _1n, _1n, _0n);
  static fromAffine(p: Point): ExtendedPoint {
    if (!(p instanceof Point)) {
      throw new TypeError('ExtendedPoint#fromAffine: expected Point');
    }
    if (p.equals(Point.ZERO)) return ExtendedPoint.ZERO;
    return new ExtendedPoint(p.x, p.y, _1n, mod(p.x * p.y));
  }
  // Takes a bunch of Jacobian Points but executes only one
  // invert on all of them. invert is very slow operation,
  // so this improves performance massively.
  static toAffineBatch(points: ExtendedPoint[]): Point[] {
    const toInv = invertBatch(points.map((p) => p.z));
    return points.map((p, i) => p.toAffine(toInv[i]));
  }

  static normalizeZ(points: ExtendedPoint[]): ExtendedPoint[] {
    return this.toAffineBatch(points).map(this.fromAffine);
  }

  // Ristretto-related methods.

  // The hash-to-group operation applies Elligator twice and adds the results.
  // https://ristretto.group/formulas/elligator.html
  static fromRistrettoHash(hash: Uint8Array): ExtendedPoint {
    if (typeof hash === 'string') hash = hexToBytes(hash);
    if (hash.length !== 64) throw new Error('Invalid ristretto hash, need 64 bytes');
    const r1 = bytes255ToNumberLE(hash.slice(0, B32));
    const R1 = this.calcElligatorRistrettoMap(r1);
    const r2 = bytes255ToNumberLE(hash.slice(B32, B32 * 2));
    const R2 = this.calcElligatorRistrettoMap(r2);
    return R1.add(R2);
  }

  // Computes Elligator map for Ristretto
  // https://ristretto.group/formulas/elligator.html
  private static calcElligatorRistrettoMap(r0: bigint) {
    const { d } = CURVE;
    const r = mod(SQRT_M1 * r0 * r0); // 1
    const Ns = mod((r + _1n) * ONE_MINUS_D_SQ); // 2
    let c = BigInt(-1); // 3
    const D = mod((c - d * r) * mod(r + d)); // 4
    let { isValid: Ns_D_is_sq, value: s } = uvRatio(Ns, D); // 5
    let s_ = mod(s * r0); // 6
    if (!edIsNegative(s_)) s_ = mod(-s_);
    if (!Ns_D_is_sq) s = s_; // 7
    if (!Ns_D_is_sq) c = r; // 8
    const Nt = mod(c * (r - _1n) * D_MINUS_ONE_SQ - D); // 9
    const s2 = s * s;
    const W0 = mod((s + s) * D); // 10
    const W1 = mod(Nt * SQRT_AD_MINUS_ONE); // 11
    const W2 = mod(_1n - s2); // 12
    const W3 = mod(_1n + s2); // 13
    return new ExtendedPoint(mod(W0 * W3), mod(W2 * W1), mod(W1 * W3), mod(W0 * W2));
  }

  // Ristretto: Decoding to Extended Coordinates
  // https://ristretto.group/formulas/decoding.html
  static fromRistrettoBytes(bytes: Hex): ExtendedPoint {
    if (typeof bytes === 'string') bytes = hexToBytes(bytes);
    if (bytes.length !== 32) throw new Error('Invalid ristretto hash, need 32 bytes');
    const { a, d } = CURVE;
    const emsg = 'ExtendedPoint.fromRistrettoBytes: Cannot convert bytes to Ristretto Point';
    const s = bytes255ToNumberLE(bytes);
    // 1. Check that s_bytes is the canonical encoding of a field element, or else abort.
    // 3. Check that s is non-negative, or else abort
    if (!equalBytes(numberToBytesPadded(s, B32), bytes) || edIsNegative(s)) throw new Error(emsg);
    const s2 = mod(s * s);
    const u1 = mod(_1n + a * s2); // 4 (a is -1)
    const u2 = mod(_1n - a * s2); // 5
    const u1_2 = mod(u1 * u1);
    const u2_2 = mod(u2 * u2);
    const v = mod(a * d * u1_2 - u2_2); // 6
    const { isValid, value: I } = invertSqrt(mod(v * u2_2)); // 7
    const Dx = mod(I * u2); // 8
    const Dy = mod(I * Dx * v); // 9
    let x = mod((s + s) * Dx); // 10
    if (edIsNegative(x)) x = mod(-x); // 10
    const y = mod(u1 * Dy); // 11
    const t = mod(x * y); // 12
    if (!isValid || edIsNegative(t) || y === _0n) throw new Error(emsg);
    return new ExtendedPoint(x, y, _1n, t);
  }

  // Ristretto: Encoding from Extended Coordinates
  // https://ristretto.group/formulas/encoding.html
  toRistrettoBytes(): Uint8Array {
    let { x, y, z, t } = this;
    const u1 = mod(mod(z + y) * mod(z - y)); // 1
    const u2 = mod(x * y); // 2
    // Square root always exists
    const { value: invsqrt } = invertSqrt(mod(u1 * u2 ** _2n)); // 3
    const D1 = mod(invsqrt * u1); // 4
    const D2 = mod(invsqrt * u2); // 5
    const zInv = mod(D1 * D2 * t); // 6
    let D: bigint; // 7
    if (edIsNegative(t * zInv)) {
      let _x = mod(y * SQRT_M1);
      let _y = mod(x * SQRT_M1);
      x = _x;
      y = _y;
      D = mod(D1 * INVSQRT_A_MINUS_D);
    } else {
      D = D2; // 8
    }
    if (edIsNegative(x * zInv)) y = mod(-y); // 9
    let s = mod((z - y) * D); // 10 (check footer's note, no sqrt(-a))
    if (edIsNegative(s)) s = mod(-s);
    return numberToBytesPadded(s, B32); // 11
  }
  // Ristretto methods end.

  // Compare one point to another.
  equals(other: ExtendedPoint): boolean {
    const a = this;
    const b = other;
    return mod(a.t * b.z) === mod(b.t * a.z);
  }

  // Inverses point to one corresponding to (x, -y) in Affine coordinates.
  negate(): ExtendedPoint {
    return new ExtendedPoint(mod(-this.x), this.y, this.z, mod(-this.t));
  }

  // Fast algo for doubling Extended Point when curve's a=-1.
  // http://hyperelliptic.org/EFD/g1p/auto-twisted-extended-1.html#doubling-dbl-2008-hwcd
  // Cost: 3M + 4S + 1*a + 7add + 1*2.
  double(): ExtendedPoint {
    const X1 = this.x;
    const Y1 = this.y;
    const Z1 = this.z;
    const { a } = CURVE;
    const A = mod(X1 ** _2n);
    const B = mod(Y1 ** _2n);
    const C = mod(_2n * Z1 ** _2n);
    const D = mod(a * A);
    const E = mod((X1 + Y1) ** _2n - A - B);
    const G = mod(D + B);
    const F = mod(G - C);
    const H = mod(D - B);
    const X3 = mod(E * F);
    const Y3 = mod(G * H);
    const T3 = mod(E * H);
    const Z3 = mod(F * G);
    return new ExtendedPoint(X3, Y3, Z3, T3);
  }

  // Fast algo for adding 2 Extended Points when curve's a=-1.
  // http://hyperelliptic.org/EFD/g1p/auto-twisted-extended-1.html#addition-add-2008-hwcd-4
  // Cost: 8M + 8add + 2*2.
  add(other: ExtendedPoint): ExtendedPoint {
    const X1 = this.x;
    const Y1 = this.y;
    const Z1 = this.z;
    const T1 = this.t;
    const X2 = other.x;
    const Y2 = other.y;
    const Z2 = other.z;
    const T2 = other.t;
    const A = mod((Y1 - X1) * (Y2 + X2));
    const B = mod((Y1 + X1) * (Y2 - X2));
    const F = mod(B - A);
    if (F === _0n) {
      // Same point.
      return this.double();
    }
    const C = mod(Z1 * _2n * T2);
    const D = mod(T1 * _2n * Z2);
    const E = mod(D + C);
    const G = mod(B + A);
    const H = mod(D - C);
    const X3 = mod(E * F);
    const Y3 = mod(G * H);
    const T3 = mod(E * H);
    const Z3 = mod(F * G);
    return new ExtendedPoint(X3, Y3, Z3, T3);
  }

  subtract(other: ExtendedPoint): ExtendedPoint {
    return this.add(other.negate());
  }

  // Non-constant-time multiplication. Uses double-and-add algorithm.
  // It's faster, but should only be used when you don't care about
  // an exposed private key e.g. sig verification.
  multiplyUnsafe(scalar: number | bigint): ExtendedPoint {
    let n = normalizeScalar(scalar);
    if (n === _1n) return this;
    let p = ExtendedPoint.ZERO;
    let d: ExtendedPoint = this;
    while (n > _0n) {
      if (n & _1n) p = p.add(d);
      d = d.double();
      n >>= _1n;
    }
    return p;
  }

  private precomputeWindow(W: number): ExtendedPoint[] {
    const windows = 256 / W + 1;
    let points: ExtendedPoint[] = [];
    let p: ExtendedPoint = this;
    let base = p;
    for (let window = 0; window < windows; window++) {
      base = p;
      points.push(base);
      for (let i = 1; i < 2 ** (W - 1); i++) {
        base = base.add(p);
        points.push(base);
      }
      p = base.double();
    }
    return points;
  }

  private wNAF(n: bigint, affinePoint?: Point): [ExtendedPoint, ExtendedPoint] {
    if (!affinePoint && this.equals(ExtendedPoint.BASE)) affinePoint = Point.BASE;
    const W = (affinePoint && affinePoint._WINDOW_SIZE) || 1;
    if (256 % W) {
      throw new Error('Point#wNAF: Invalid precomputation window, must be power of 2');
    }

    let precomputes = affinePoint && pointPrecomputes.get(affinePoint);
    if (!precomputes) {
      precomputes = this.precomputeWindow(W);
      if (affinePoint && W !== 1) {
        precomputes = ExtendedPoint.normalizeZ(precomputes);
        pointPrecomputes.set(affinePoint, precomputes);
      }
    }

    let p = ExtendedPoint.ZERO;
    let f = ExtendedPoint.ZERO;

    const windows = 256 / W + 1;
    const windowSize = 2 ** (W - 1);
    const mask = BigInt(2 ** W - 1); // Create mask with W ones: 0b1111 for W=4 etc.
    const maxNumber = 2 ** W;
    const shiftBy = BigInt(W);

    for (let window = 0; window < windows; window++) {
      const offset = window * windowSize;
      // Extract W bits.
      let wbits = Number(n & mask);

      // Shift number by W bits.
      n >>= shiftBy;

      // If the bits are bigger than max size, we'll split those.
      // +224 => 256 - 32
      if (wbits > windowSize) {
        wbits -= maxNumber;
        n += _1n;
      }

      // Check if we're onto Zero point.
      // Add random point inside current window to f.
      if (wbits === 0) {
        let pr = precomputes[offset];
        if (window % 2) pr = pr.negate();
        f = f.add(pr);
      } else {
        let cached = precomputes[offset + Math.abs(wbits) - 1];
        if (wbits < 0) cached = cached.negate();
        p = p.add(cached);
      }
    }
    return [p, f];
  }

  // Constant time multiplication.
  // Uses wNAF method. Windowed method may be 10% faster,
  // but takes 2x longer to generate and consumes 2x memory.
  multiply(scalar: number | bigint, affinePoint?: Point): ExtendedPoint {
    const n = normalizeScalar(scalar);
    return ExtendedPoint.normalizeZ(this.wNAF(n, affinePoint))[0];
  }

  // Converts Extended point to default (x, y) coordinates.
  // Can accept precomputed Z^-1 - for example, from invertBatch.
  toAffine(invZ: bigint = invert(this.z)): Point {
    const x = mod(this.x * invZ);
    const y = mod(this.y * invZ);
    return new Point(x, y);
  }
}

// Stores precomputed values for points.
const pointPrecomputes = new WeakMap<Point, ExtendedPoint[]>();

// Default Point works in default aka affine coordinates: (x, y)
class Point {
  // Base point aka generator
  // public_key = Point.BASE * private_key
  static BASE: Point = new Point(CURVE.Gx, CURVE.Gy);
  // Identity point aka point at infinity
  // point = point + zero_point
  static ZERO: Point = new Point(_0n, _1n);
  // We calculate precomputes for elliptic curve point multiplication
  // using windowed method. This specifies window size and
  // stores precomputed values. Usually only base point would be precomputed.
  _WINDOW_SIZE?: number;

  constructor(readonly x: bigint, readonly y: bigint) {}

  // "Private method", don't use it directly.
  _setWindowSize(windowSize: number) {
    this._WINDOW_SIZE = windowSize;
    pointPrecomputes.delete(this);
  }
  // Converts hash string or Uint8Array to Point.
  // Uses algo from RFC8032 5.1.3.
  static fromHex(hash: Hex) {
    const { d, P } = CURVE;
    const bytes = hash instanceof Uint8Array ? hash : hexToBytes(hash);
    if (bytes.length !== 32) throw new Error('Point.fromHex: expected 32 bytes');
    // 1.  First, interpret the string as an integer in little-endian
    // representation. Bit 255 of this number is the least significant
    // bit of the x-coordinate and denote this value x_0.  The
    // y-coordinate is recovered simply by clearing this bit.  If the
    // resulting value is >= p, decoding fails.
    const last = bytes[31];
    const normedLast = last & ~0x80;
    const isLastByteOdd = (last & 0x80) !== 0;
    const normed = Uint8Array.from(Array.from(bytes.slice(0, 31)).concat(normedLast));
    const y = bytesToNumberLE(normed);
    if (y >= P) throw new Error('Point.fromHex expects hex <= Fp');

    // 2.  To recover the x-coordinate, the curve equation implies
    // x² = (y² - 1) / (d y² + 1) (mod p).  The denominator is always
    // non-zero mod p.  Let u = y² - 1 and v = d y² + 1.
    const y2 = mod(y * y);
    const u = mod(y2 - _1n);
    const v = mod(d * y2 + _1n);
    let { isValid, value: x } = uvRatio(u, v);
    if (!isValid) throw new Error('Point.fromHex: invalid y coordinate');

    // 4.  Finally, use the x_0 bit to select the right square root.  If
    // x = 0, and x_0 = 1, decoding fails.  Otherwise, if x_0 != x mod
    // 2, set x <-- p - x.  Return the decoded point (x,y).
    const isXOdd = (x & _1n) === _1n;
    if (isLastByteOdd !== isXOdd) {
      x = mod(-x);
    }
    return new Point(x, y);
  }

  static async fromPrivateKey(privateKey: PrivKey) {
    const privBytes = await getPrivateBytes(privateKey);
    return Point.BASE.multiply(encodePrivate(privBytes));
  }

  /**
   * Converts point to compressed representation of its Y.
   * ECDSA uses `04${x}${y}` to represent long form and
   * `02${x}` / `03${x}` to represent short form,
   * where leading bit signifies positive or negative Y.
   * EDDSA (ed25519) uses short form.
   */
  toRawBytes(): Uint8Array {
    const hex = numberToHex(this.y);
    const u8 = new Uint8Array(B32);
    for (let i = hex.length - 2, j = 0; j < B32 && i >= 0; i -= 2, j++) {
      u8[j] = parseHexByte(hex[i] + hex[i + 1]);
    }
    const mask = this.x & _1n ? 0x80 : 0;
    u8[B32 - 1] |= mask;
    return u8;
  }

  // Same as toRawBytes, but returns string.
  toHex(): string {
    return bytesToHex(this.toRawBytes());
  }

  // Converts to Montgomery; aka x coordinate of curve25519.
  // We don't have fromX25519, because we don't know sign!
  toX25519() {
    // curve25519 is birationally equivalent to ed25519
    // x, y: ed25519 coordinates
    // u, v: x25519 coordinates
    // u = (1 + y) / (1 - y)
    // See https://blog.filippo.io/using-ed25519-keys-for-encryption
    return mod((_1n + this.y) * invert(_1n - this.y));
  }

  equals(other: Point): boolean {
    return this.x === other.x && this.y === other.y;
  }

  negate() {
    return new Point(mod(-this.x), this.y);
  }

  add(other: Point) {
    return ExtendedPoint.fromAffine(this).add(ExtendedPoint.fromAffine(other)).toAffine();
  }

  subtract(other: Point) {
    return this.add(other.negate());
  }

  // Constant time multiplication.
  multiply(scalar: number | bigint): Point {
    return ExtendedPoint.fromAffine(this).multiply(scalar, this).toAffine();
  }
}

class Signature {
  constructor(readonly r: Point, readonly s: bigint) {
    if (!(r instanceof Point)) throw new Error('Expected Point instance');
    if (!isWithinCurveOrder(s)) throw new Error('Signature expects 0 <s <= CURVE.n');
  }

  static fromHex(hex: Hex) {
    hex = ensureBytes(hex);
    if (hex.length !== 64) throw new Error('Expected 64-byte hex');
    const r = Point.fromHex(hex.slice(0, 32));
    const s = bytesToNumberLE(hex.slice(32));
    return new Signature(r, s);
  }

  toRawBytes() {
    const numberBytes = hexToBytes(numberToHex(this.s)).reverse();
    const sBytes = new Uint8Array(B32);
    sBytes.set(numberBytes);
    const res = new Uint8Array(B32 * 2);
    res.set(this.r.toRawBytes());
    res.set(sBytes, 32);
    return res;
  }

  toHex() {
    return bytesToHex(this.toRawBytes());
  }
}

export { ExtendedPoint, Point, Signature };

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  if (arrays.length === 1) return arrays[0];
  const length = arrays.reduce((a, arr) => a + arr.length, 0);
  const result = new Uint8Array(length);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const arr = arrays[i];
    result.set(arr, pad);
    pad += arr.length;
  }
  return result;
}

// Convert between types
// ---------------------
const hexes = Array.from({ length: 256 }, (v, i) => i.toString(16).padStart(2, '0'));
function bytesToHex(uint8a: Uint8Array): string {
  // pre-caching chars could speed this up 6x.
  let hex = '';
  for (let i = 0; i < uint8a.length; i++) {
    hex += hexes[uint8a[i]];
  }
  return hex;
}

function parseHexByte(hexByte: string): number {
  const byte = Number.parseInt(hexByte, 16);
  if (Number.isNaN(byte)) throw new Error('Invalid byte sequence');
  return byte;
}

function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string') {
    throw new TypeError('hexToBytes: expected string, got ' + typeof hex);
  }
  if (hex.length % 2) throw new Error('hexToBytes: received invalid unpadded hex');
  const array = new Uint8Array(hex.length / 2);
  for (let i = 0; i < array.length; i++) {
    const j = i * 2;
    array[i] = parseHexByte(hex.slice(j, j + 2));
  }
  return array;
}

function numberToHex(num: number | bigint): string {
  const hex = num.toString(16);
  return hex.length & 1 ? `0${hex}` : hex;
}

function numberToBytesPadded(num: bigint, length: number = B32) {
  const hex = numberToHex(num).padStart(length * 2, '0');
  return hexToBytes(hex).reverse();
}

// Little-endian check for first LE bit (last BE bit);
function edIsNegative(num: bigint) {
  return (mod(num) & _1n) === _1n;
}

// Little Endian
function bytesToNumberLE(uint8a: Uint8Array): bigint {
  let value = _0n;
  for (let i = 0; i < uint8a.length; i++) {
    value += BigInt(uint8a[i]) << (BigInt(8) * BigInt(i));
  }
  return value;
}

function bytes255ToNumberLE(bytes: Uint8Array): bigint {
  return mod(bytesToNumberLE(bytes) & (_2n ** _255n - _1n));
}
// -------------------------

function mod(a: bigint, b: bigint = CURVE.P) {
  const res = a % b;
  return res >= _0n ? res : b + res;
}

// Note: this egcd-based invert is faster than powMod-based one.
// Inverses number over modulo
function invert(number: bigint, modulo: bigint = CURVE.P): bigint {
  if (number === _0n || modulo <= _0n) {
    throw new Error(`invert: expected positive integers, got n=${number} mod=${modulo}`);
  }
  // Eucledian GCD https://brilliant.org/wiki/extended-euclidean-algorithm/
  let a = mod(number, modulo);
  let b = modulo;
  // prettier-ignore
  let x = _0n, y = _1n, u = _1n, v = _0n;
  while (a !== _0n) {
    const q = b / a;
    const r = b % a;
    const m = x - u * q;
    const n = y - v * q;
    // prettier-ignore
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd = b;
  if (gcd !== _1n) throw new Error('invert: does not exist');
  return mod(x, modulo);
}

function invertBatch(nums: bigint[], modulo: bigint = CURVE.P): bigint[] {
  const len = nums.length;
  const scratch = new Array(len);
  let acc = _1n;
  for (let i = 0; i < len; i++) {
    if (nums[i] === _0n) continue;
    scratch[i] = acc;
    acc = mod(acc * nums[i], modulo);
  }
  acc = invert(acc, modulo);
  for (let i = len - 1; i >= 0; i--) {
    if (nums[i] === _0n) continue;
    let tmp = mod(acc * nums[i], modulo);
    nums[i] = mod(acc * scratch[i], modulo);
    acc = tmp;
  }
  return nums;
}

// Does x ^ (2 ^ power) mod p. pow2(30, 4) == 30 ^ (2 ^ 4)
function pow2(x: bigint, power: bigint): bigint {
  const { P } = CURVE;
  let res = x;
  while (power-- > _0n) {
    res *= res;
    res %= P;
  }
  return res;
}

// Power to (p-5)/8 aka x^(2^252-3)
// Used to calculate y - the square root of y².
// Exponentiates it to very big number.
// We are unwrapping the loop because it's 2x faster.
// (2n**252n-3n).toString(2) would produce bits [250x 1, 0, 1]
// We are multiplying it bit-by-bit
function pow_2_252_3(x: bigint): bigint {
  const { P } = CURVE;
  const _5n = BigInt(5);
  const _10n = BigInt(10);
  const _20n = BigInt(20);
  const _40n = BigInt(40);
  const _80n = BigInt(80);
  const x2 = (x * x) % P;
  const b2 = (x2 * x) % P; // x^3, 11
  const b4 = (pow2(b2, _2n) * b2) % P; // x^15, 1111
  const b5 = (pow2(b4, _1n) * x) % P; // x^31
  const b10 = (pow2(b5, _5n) * b5) % P;
  const b20 = (pow2(b10, _10n) * b10) % P;
  const b40 = (pow2(b20, _20n) * b20) % P;
  const b80 = (pow2(b40, _40n) * b40) % P;
  const b160 = (pow2(b80, _80n) * b80) % P;
  const b240 = (pow2(b160, _80n) * b80) % P;
  const b250 = (pow2(b240, _10n) * b10) % P;
  const pow_p_5_8 = (pow2(b250, _2n) * x) % P;
  // ^ To pow to (p+3)/8, multiply it by x.
  return pow_p_5_8;
}

// Ratio of u to v. Allows us to combine inversion and square root. Uses algo from RFC8032 5.1.3.
// Constant-time
// prettier-ignore
function uvRatio(u: bigint, v: bigint): {isValid: boolean, value: bigint} {
  const v3 = mod(v * v * v);                  // v³
  const v7 = mod(v3 * v3 * v);                // v⁷
  let x = mod(u * v3 * pow_2_252_3(u * v7));  // (uv³)(uv⁷)^(p-5)/8
  const vx2 = mod(v * x * x);                 // vx²
  const root1 = x;                            // First root candidate
  const root2 = mod(x * SQRT_M1);             // Second root candidate
  const useRoot1 = vx2 === u;                 // If vx² = u (mod p), x is a square root
  const useRoot2 = vx2 === mod(-u);           // If vx² = -u, set x <-- x * 2^((p-1)/4)
  const noRoot = vx2 === mod(-u * SQRT_M1);   // There is no valid root, vx² = -u√(-1)
  if (useRoot1) x = root1;
  if (useRoot2 || noRoot) x = root2;          // We return root2 anyway, for const-time
  if (edIsNegative(x)) x = mod(-x);
  return { isValid: useRoot1 || useRoot2, value: x };
}

// Calculates 1/√(number)
function invertSqrt(number: bigint) {
  return uvRatio(_1n, number);
}
// Math end

async function sha512ToNumberLE(...args: Uint8Array[]): Promise<bigint> {
  const messageArray = concatBytes(...args);
  const hash = await utils.sha512(messageArray);
  const value = bytesToNumberLE(hash);
  return mod(value, CURVE.n);
}

function keyPrefix(privateBytes: Uint8Array) {
  return privateBytes.slice(B32);
}

function encodePrivate(privateBytes: Uint8Array): bigint {
  const last = B32 - 1;
  const head = privateBytes.slice(0, B32);
  head[0] &= 248;
  head[last] &= 127;
  head[last] |= 64;
  return mod(bytesToNumberLE(head), CURVE.n);
}

function equalBytes(b1: Uint8Array, b2: Uint8Array) {
  // We don't care about timing attacks here
  if (b1.length !== b2.length) {
    return false;
  }
  for (let i = 0; i < b1.length; i++) {
    if (b1[i] !== b2[i]) {
      return false;
    }
  }
  return true;
}

function ensureBytes(hash: Hex): Uint8Array {
  return hash instanceof Uint8Array ? hash : hexToBytes(hash);
}

function isWithinCurveOrder(num: bigint): boolean {
  return 0 < num && num < CURVE.n;
}

const MAX_PRIV_KEY = _2n ** BigInt(256) - _1n;
function normalizePrivateKey(key: PrivKey): Uint8Array {
  let bytes: Uint8Array;
  let err = 'Expected 32 bytes of private key';
  if (typeof key === 'bigint' || (typeof key === 'number' && Number.isSafeInteger(key))) {
    let num = BigInt(key);
    if (num < 0 || num > MAX_PRIV_KEY) throw new Error(err);
    bytes = hexToBytes(num.toString(16).padStart(B32 * 2, '0'));
  } else if (typeof key === 'string') {
    if (key.length !== 64) throw new Error(err);
    bytes = hexToBytes(key);
  } else if (key instanceof Uint8Array) {
    if (key.length !== 32) throw new Error(err);
    bytes = key;
  } else {
    throw new TypeError('Expected valid private key');
  }
  // There is no check for isWithinCurveOrder
  return bytes;
}

async function getPrivateBytes(privateKey: PrivKey) {
  return await utils.sha512(normalizePrivateKey(privateKey));
}

function normalizeScalar(num: number | bigint): bigint {
  if (typeof num === 'number' && num > 0 && Number.isSafeInteger(num)) return BigInt(num);
  if (typeof num === 'bigint' && isWithinCurveOrder(num)) return num;
  throw new TypeError('Expected valid private scalar: 0 < scalar < curve.n');
}

export async function getPublicKey(privateKey: PrivKey): Promise<Uint8Array> {
  const key = await Point.fromPrivateKey(privateKey);
  return key.toRawBytes();
}

export async function sign(msgHash: Hex, privateKey: Hex): Promise<Uint8Array> {
  const privBytes = await getPrivateBytes(privateKey);
  const p = encodePrivate(privBytes);
  const P = Point.BASE.multiply(p);
  const msg = ensureBytes(msgHash);
  const r = await sha512ToNumberLE(keyPrefix(privBytes), msg);
  const R = Point.BASE.multiply(r);
  const h = await sha512ToNumberLE(R.toRawBytes(), P.toRawBytes(), msg);
  const S = mod(r + h * p, CURVE.n);
  const sig = new Signature(R, S);
  return sig.toRawBytes();
}

export async function verify(sig: SigType, msgHash: Hex, publicKey: PubKey): Promise<boolean> {
  msgHash = ensureBytes(msgHash);
  if (!(publicKey instanceof Point)) publicKey = Point.fromHex(publicKey);
  if (!(sig instanceof Signature)) sig = Signature.fromHex(sig);
  const hs = await sha512ToNumberLE(sig.r.toRawBytes(), publicKey.toRawBytes(), msgHash);
  const Ph = ExtendedPoint.fromAffine(publicKey).multiplyUnsafe(hs);
  const Gs = ExtendedPoint.BASE.multiply(sig.s);
  const RPh = ExtendedPoint.fromAffine(sig.r).add(Ph);
  return RPh.subtract(Gs).multiplyUnsafe(CURVE.h).equals(ExtendedPoint.ZERO);
}

// Enable precomputes. Slows down first publicKey computation by 20ms.
Point.BASE._setWindowSize(8);

// Global symbol available in browsers only. Ensure we do not depend on @types/dom

// HACK: change the sniffing to handle deno too
const isDeno = (globalThis as any).Deno !== undefined;
const isNode = (globalThis as any).process !== undefined;
const isWeb = !isDeno && !isNode;
const crypto: { node?: any; web?: any } = {
  node: nodeCrypto,
  web: isWeb ? (globalThis as any).crypto : undefined,
  //web: undefined, //typeof self === 'object' && 'crypto' in self ? self.crypto : undefined,
};
// END HACK

export const utils = {
  // The 8-torsion subgroup ℰ8.
  // Those are "buggy" points, if you multiply them by 8, you'll receive Point.ZERO.
  // Ported from curve25519-dalek.
  TORSION_SUBGROUP: [
    '0100000000000000000000000000000000000000000000000000000000000000',
    'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
    '0000000000000000000000000000000000000000000000000000000000000080',
    '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
    'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85',
    '0000000000000000000000000000000000000000000000000000000000000000',
    'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
  ],
  bytesToHex,
  randomBytes: (bytesLength: number = 32): Uint8Array => {
    if (crypto.web) {
      return crypto.web.getRandomValues(new Uint8Array(bytesLength));
    } else if (crypto.node) {
      const { randomBytes } = crypto.node;
      return new Uint8Array(randomBytes(bytesLength).buffer);
    } else {
      throw new Error("The environment doesn't have randomBytes function");
    }
  },
  // Note: ed25519 private keys are uniform 32-bit strings. We do not need
  // to check for modulo bias like we do in noble-secp256k1 randomPrivateKey()
  randomPrivateKey: (): Uint8Array => {
    return utils.randomBytes(32);
  },
  sha512: async (message: Uint8Array): Promise<Uint8Array> => {
    if (crypto.web) {
      const buffer = await crypto.web.subtle.digest('SHA-512', message.buffer);
      return new Uint8Array(buffer);
    } else if (crypto.node) {
      return Uint8Array.from(crypto.node.createHash('sha512').update(message).digest());
    } else {
      throw new Error("The environment doesn't have sha512 function");
    }
  },
  precompute(windowSize = 8, point = Point.BASE): Point {
    const cached = point.equals(Point.BASE) ? point : new Point(point.x, point.y);
    cached._setWindowSize(windowSize);
    cached.multiply(_1n);
    return cached;
  },
};
