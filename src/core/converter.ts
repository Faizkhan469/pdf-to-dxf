/**
 * pdf-to-dxf — Core conversion engine
 * Part of the ek-mc civil toolset
 *
 * Strategy:
 *  1. Parse each PDF page with pdfjs-dist to extract vector paths and text.
 *  2. Translate each element into DXF entities using @tarikjabiri/dxf DxfWriter.
 *  3. Return the DXF string (or write to file in CLI mode).
 *
 * Notes on pdfjs `constructPath`:
 *  pdfjs has changed the argument shape of `constructPath` across versions:
 *   - v2/v3/v5: args = [ops: number[], opArgs: any[]]  (raw PDF operators)
 *   - v4:       args = [intent, [Float32Array|null], Float32Array|null]
 *               where the Float32Array is a "packed path" (0/1/2/3/4 codes)
 *  `decodeConstructPath` sniffs the shape and normalizes both formats.
 *
 * Coordinate mapping:
 *  PDF uses bottom-left origin; DXF (AutoCAD) also uses bottom-left — no flip needed.
 *  PDF units are points (1 pt = 1/72 inch). Preserved as-is; scale via the `scale` option.
 *
 * Circle handling:
 *  A PDF circle is 4 cubic Béziers. We emit a true DXF CIRCLE only when the
 *  current transformation matrix is a similarity (rotation + uniform scale +
 *  translation, optionally reflected). Under non-uniform scale or shear, the
 *  circle would become an ellipse in DXF space, so we fall back to adaptive
 *  Bézier tessellation instead of emitting a wrong circle.
 */

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { DxfWriter, Colors, point3d } from '@tarikjabiri/dxf';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure the pdfjs worker for browser environments.
// The worker is bundled locally and served by the app (no CDN dependency).
// In Node (CLI), the worker is set separately in src/cli/index.ts.
if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export interface ConvertOptions {
  /** Pages to convert, 1-indexed. Defaults to all pages. */
  pages?: number[];
  /** Uniform scale factor applied to all coordinates. Default: 1. */
  scale?: number;
  /** Layer name prefix for each page. Default: "PAGE". */
  layerPrefix?: string;
  /** Include text entities. Default: true. */
  includeText?: boolean;
  /** Include vector paths. Default: true. */
  includePaths?: boolean;
  /** Map PDF stroke colors to nearest ACI color. Default: true. */
  preserveColors?: boolean;
  /** Preserve PDF stroke line widths in DXF. Default: true. */
  preserveLineWidths?: boolean;
}

export interface ConvertResult {
  dxf: string;
  pageCount: number;
  warnings: string[];
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Vec3 = { x: number; y: number; z: number };
type Matrix2D = [number, number, number, number, number, number];

const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0];

function pt(x: number, y: number): Vec3 {
  return point3d(x, y, 0);
}

/** Apply a PDF affine matrix [a,b,c,d,e,f] to a point. */
function transformPoint(x: number, y: number, matrix: Matrix2D, scale: number): Vec3 {
  const [a, b, c, d, e, f] = matrix;
  return pt((a * x + c * y + e) * scale, (b * x + d * y + f) * scale);
}

/** Concatenate a PDF cm matrix with the current transformation matrix. */
function multiplyMatrices(current: Matrix2D, next: ArrayLike<number>): Matrix2D {
  const [a, b, c, d, e, f] = current;
  const na = Number(next[0]);
  const nb = Number(next[1]);
  const nc = Number(next[2]);
  const nd = Number(next[3]);
  const ne = Number(next[4]);
  const nf = Number(next[5]);
  return [
    a * na + c * nb,
    b * na + d * nb,
    a * nc + c * nd,
    b * nc + d * nd,
    a * ne + c * nf + e,
    b * ne + d * nf + f,
  ];
}

/** Extract rotation angle (radians) from a PDF text transform. */
function extractTextRotation(m: ArrayLike<number>): number {
  const a = Number(m[0]);
  const b = Number(m[1]);
  return Math.atan2(b, a);
}

/**
 * True if the matrix is a pure similarity (rotation + uniform scale +
 * translation, optionally reflected). Under such a transform, a PDF circle
 * remains a circle, so a CIRCLE entity is valid.
 */
function isSimilarityMatrix(m: Matrix2D): boolean {
  const [a, b, c, d] = m;
  const col1 = Math.hypot(a, b);
  const col2 = Math.hypot(c, d);
  if (col1 === 0 || col2 === 0) return false;
  const dot = a * c + b * d;
  const scaleDiff = Math.abs(col1 - col2) / Math.max(col1, col2);
  const orthoDiff = Math.abs(dot) / (col1 * col2);
  return scaleDiff < 1e-3 && orthoDiff < 1e-3;
}

// ─── Path sub-op codes used by our internal representation ──────────────────
// These are stable internal codes — NOT the same as pdfjs.OPS.*.
const PATH_OPS = {
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
} as const;

// ─── Stroke state (color + line width) ───────────────────────────────────────

interface StrokeState {
  /** ACI color index, or undefined for BYLAYER default. */
  color?: number;
  /** Line width in pt (PDF units), or undefined for default. */
  lineWidth?: number;
}

/** Convert an RGB triple (0..1 each) to the nearest ACI index. */
function rgbToAci(r: number, g: number, b: number): number {
  const palette: Array<[number, number, number, number]> = [
    [0, 0, 0, 0],       // 0 – BYBLOCK (unused)
    [255, 0, 0, 1],     // 1 – red
    [255, 255, 0, 2],   // 2 – yellow
    [0, 255, 0, 3],     // 3 – green
    [0, 255, 255, 4],   // 4 – cyan
    [0, 0, 255, 5],     // 5 – blue
    [255, 0, 255, 6],   // 6 – magenta
    [255, 255, 255, 7], // 7 – white/black
  ];
  const R = Math.round(r * 255);
  const G = Math.round(g * 255);
  const B = Math.round(b * 255);

  let best = 7;
  let bestDist = Infinity;
  for (const [pr, pg, pb, aci] of palette) {
    if (aci === 0) continue;
    const d = (R - pr) ** 2 + (G - pg) ** 2 + (B - pb) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = aci;
    }
  }
  return best;
}

/** Clamp a PDF line width (pt) to a standard DXF lineweight (hundredths of mm). */
function ptToLineweight(ptWidth: number): number {
  const hundredthsMm = Math.round(ptWidth * 35.28); // 1 pt ≈ 0.3528 mm
  const standard = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200];
  let closest = 0;
  let minDelta = Infinity;
  for (const w of standard) {
    const d = Math.abs(w - hundredthsMm);
    if (d < minDelta) {
      minDelta = d;
      closest = w;
    }
  }
  return closest;
}

// ─── Adaptive Bézier Subdivision ─────────────────────────────────────────────

const BEZIER_TOLERANCE = 0.5;
const BEZIER_MAX_DEPTH = 12;

function chordalDeviation(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): number {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const d2 = Math.hypot(p2.x - p0.x, p2.y - p0.y);
    return Math.max(d1, d2);
  }
  const cross1 = Math.abs(dx * (p0.y - p1.y) - dy * (p0.x - p1.x)) / Math.sqrt(lenSq);
  const cross2 = Math.abs(dx * (p0.y - p2.y) - dy * (p0.x - p2.x)) / Math.sqrt(lenSq);
  return Math.max(cross1, cross2);
}

export function approximateBezierAdaptive(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  writer: DxfWriter,
  tolerance = BEZIER_TOLERANCE,
  depth = 0,
  stroke?: StrokeState,
): void {
  if (depth >= BEZIER_MAX_DEPTH || chordalDeviation(p0, p1, p2, p3) <= tolerance) {
    emitLine(writer, p0, p3, stroke);
    return;
  }

  const m01 = pt((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
  const m12 = pt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
  const m23 = pt((p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
  const m012 = pt((m01.x + m12.x) / 2, (m01.y + m12.y) / 2);
  const m123 = pt((m12.x + m23.x) / 2, (m12.y + m23.y) / 2);
  const mid = pt((m012.x + m123.x) / 2, (m012.y + m123.y) / 2);

  approximateBezierAdaptive(p0, m01, m012, mid, writer, tolerance, depth + 1, stroke);
  approximateBezierAdaptive(mid, m123, m23, p3, writer, tolerance, depth + 1, stroke);
}

// ─── Line emitter ────────────────────────────────────────────────────────────

/**
 * Emit a DXF line, skipping zero-length segments and applying stroke styling.
 * The threshold is scale-relative: 1e-9 squared ≈ 3.16e-5 units, invisible at
 * any practical drawing scale but preserves legitimate short segments.
 */
function emitLine(writer: DxfWriter, a: Vec3, b: Vec3, stroke?: StrokeState): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx * dx + dy * dy < 1e-9) return;

  try {
    const opts: any = {};
    if (stroke?.color !== undefined) opts.color = stroke.color;
    if (stroke?.lineWidth !== undefined) opts.lineWeight = ptToLineweight(stroke.lineWidth);
    if (Object.keys(opts).length > 0) {
      (writer.addLine as any)(a, b, opts);
    } else {
      writer.addLine(a, b);
    }
  } catch {
    writer.addLine(a, b);
  }
}

// ─── Circle fitting ──────────────────────────────────────────────────────────

const CIRCLE_FIT_TOLERANCE = 0.15;
const CIRCLE_FIT_RADIUS_MIN = 1.0;
const KAPPA = 0.5522847498;
const KAPPA_TOLERANCE = 0.05;

interface SubPath {
  ops: Array<
    | { type: 'line'; to: Vec3 }
    | { type: 'curve'; p1: Vec3; p2: Vec3; p3: Vec3; isCurveTo2?: boolean }
  >;
  start: Vec3;
  closed: boolean;
}

function fitCircle(points: Vec3[]): { cx: number; cy: number; r: number } | null {
  if (points.length < 3) return null;

  let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0;
  let sumXY = 0, sumX3 = 0, sumY3 = 0, sumXY2 = 0, sumX2Y = 0;
  const n = points.length;

  for (const p of points) {
    const x = p.x, y = p.y;
    sumX += x; sumY += y;
    sumX2 += x * x; sumY2 += y * y;
    sumXY += x * y;
    sumX3 += x * x * x; sumY3 += y * y * y;
    sumXY2 += x * y * y; sumX2Y += x * x * y;
  }

  const A = 2 * (sumX2 - sumX * sumX / n);
  const B = 2 * (sumXY - sumX * sumY / n);
  const C = 2 * (sumY2 - sumY * sumY / n);
  const D = sumX3 + sumXY2 - (sumX2 + sumY2) * sumX / n;
  const E = sumX2Y + sumY3 - (sumX2 + sumY2) * sumY / n;

  const det = A * C - B * B;
  if (Math.abs(det) < 1e-10) return null;

  const cx = (D * C - B * E) / det;
  const cy = (A * E - B * D) / det;
  const r = Math.sqrt((sumX2 + sumY2 - 2 * cx * sumX - 2 * cy * sumY) / n + cx * cx + cy * cy);

  if (!isFinite(r) || r <= 0) return null;
  return { cx, cy, r };
}

/**
 * Check if a closed sub-path with exactly 4 curveTo ops is a circle.
 * Only attempted when `similarity` is true — under non-uniform/sheared
 * transforms, the PDF circle becomes an ellipse and a CIRCLE entity
 * would be wrong. Returns { cx, cy, r } or null.
 */
function tryFitCircleFromSubPath(
  sub: SubPath,
  similarity: boolean,
): { cx: number; cy: number; r: number } | null {
  if (!similarity) return null;
  if (!sub.closed) return null;

  const curves = sub.ops.filter((o) => o.type === 'curve');
  if (curves.length !== 4) return null;
  // Reject curveTo2 (sentinel p1 makes kappa validation unreliable).
  if (curves.some((c: any) => c.isCurveTo2)) return null;

  const anchors: Vec3[] = [sub.start];
  for (const op of sub.ops) {
    if (op.type === 'curve') anchors.push(op.p3);
  }
  const pts = anchors.slice(0, 4);

  const fit = fitCircle(pts);
  if (!fit) return null;
  if (fit.r < CIRCLE_FIT_RADIUS_MIN) return null;

  for (const p of pts) {
    const dist = Math.abs(Math.hypot(p.x - fit.cx, p.y - fit.cy) - fit.r);
    if (dist > CIRCLE_FIT_TOLERANCE) return null;
  }

  // Kappa ratio check: each quadrant's control-point offsets ≈ KAPPA * r.
  let pos = sub.start;
  for (const op of sub.ops) {
    if (op.type !== 'curve') continue;
    const d1 = Math.hypot(op.p1.x - pos.x, op.p1.y - pos.y);
    const d2 = Math.hypot(op.p2.x - op.p3.x, op.p2.y - op.p3.y);
    const expected = KAPPA * fit.r;
    if (
      Math.abs(d1 - expected) / expected > KAPPA_TOLERANCE ||
      Math.abs(d2 - expected) / expected > KAPPA_TOLERANCE
    ) {
      return null;
    }
    pos = op.p3;
  }

  return fit;
}

// ─── Sub-path collector ──────────────────────────────────────────────────────

function collectSubPaths(
  subOps: number[],
  coords: number[],
  scale: number,
  matrix: Matrix2D = IDENTITY_MATRIX,
): SubPath[] {
  const paths: SubPath[] = [];
  let current: SubPath | null = null;
  let ci = 0;
  const map = (x: number, y: number) => transformPoint(x, y, matrix, scale);

  for (const op of subOps) {
    switch (op) {
      case PATH_OPS.moveTo: {
        const p = map(coords[ci], coords[ci + 1]);
        ci += 2;
        current = { ops: [], start: p, closed: false };
        paths.push(current);
        break;
      }

      case PATH_OPS.lineTo: {
        const to = map(coords[ci], coords[ci + 1]);
        ci += 2;
        if (current) current.ops.push({ type: 'line', to });
        break;
      }

      case PATH_OPS.curveTo: {
        const p1 = map(coords[ci], coords[ci + 1]);
        const p2 = map(coords[ci + 2], coords[ci + 3]);
        const p3 = map(coords[ci + 4], coords[ci + 5]);
        ci += 6;
        if (current) current.ops.push({ type: 'curve', p1, p2, p3 });
        break;
      }

      case PATH_OPS.curveTo2: {
        // Explicit flag — robust to coincident control points.
        const p2 = map(coords[ci], coords[ci + 1]);
        const p3 = map(coords[ci + 2], coords[ci + 3]);
        ci += 4;
        if (current) {
          current.ops.push({ type: 'curve', p1: p3, p2, p3, isCurveTo2: true });
        }
        break;
      }

      case PATH_OPS.curveTo3: {
        // p2 is a real control point; do NOT collapse it to p3.
        const p1 = map(coords[ci], coords[ci + 1]);
        const p2 = map(coords[ci + 2], coords[ci + 3]);
        const p3 = map(coords[ci + 4], coords[ci + 5]);
        ci += 6;
        if (current) current.ops.push({ type: 'curve', p1, p2, p3 });
        break;
      }

      case PATH_OPS.closePath: {
        if (current) current.closed = true;
        break;
      }

      case PATH_OPS.rectangle: {
        const rx = coords[ci];
        const ry = coords[ci + 1];
        const rw = coords[ci + 2];
        const rh = coords[ci + 3];
        ci += 4;
        const bl = map(rx, ry);
        const br = map(rx + rw, ry);
        const tr = map(rx + rw, ry + rh);
        const tl = map(rx, ry + rh);
        const rectPath: SubPath = {
          start: bl,
          ops: [
            { type: 'line', to: br },
            { type: 'line', to: tr },
            { type: 'line', to: tl },
            { type: 'line', to: bl },
          ],
          closed: true,
        };
        paths.push(rectPath);
        current = rectPath;
        break;
      }

      default:
        break;
    }
  }

  return paths;
}

// ─── Sub-path emitter ────────────────────────────────────────────────────────

function emitSubPath(
  sub: SubPath,
  writer: DxfWriter,
  stroke: StrokeState | undefined,
  matrix: Matrix2D,
): void {
  const similarity = isSimilarityMatrix(matrix);
  const circle = tryFitCircleFromSubPath(sub, similarity);

  if (circle) {
    try {
      const opts: any = {};
      if (stroke?.color !== undefined) opts.color = stroke.color;
      if (stroke?.lineWidth !== undefined) opts.lineWeight = ptToLineweight(stroke.lineWidth);
      if (Object.keys(opts).length > 0) {
        (writer.addCircle as any)(pt(circle.cx, circle.cy), circle.r, opts);
      } else {
        writer.addCircle(pt(circle.cx, circle.cy), circle.r);
      }
    } catch {
      writer.addCircle(pt(circle.cx, circle.cy), circle.r);
    }
    return;
  }

  let pos = sub.start;

  for (const op of sub.ops) {
    if (op.type === 'line') {
      emitLine(writer, pos, op.to, stroke);
      pos = op.to;
    } else {
      const p1 = op.isCurveTo2 ? pos : op.p1;
      approximateBezierAdaptive(pos, p1, op.p2, op.p3, writer, BEZIER_TOLERANCE, 0, stroke);
      pos = op.p3;
    }
  }

  if (sub.closed) {
    const gx = pos.x - sub.start.x;
    const gy = pos.y - sub.start.y;
    if (gx * gx + gy * gy >= 1e-9) {
      emitLine(writer, pos, sub.start, stroke);
    }
  }
}

// ─── constructPath decoding (pdfjs v4 + v5 compatible) ─────────────────────

interface DecodedPath {
  subOps: number[];
  coords: number[];
}

/**
 * Decode a pdfjs `constructPath` operator's args into internal subOps/coords.
 * Handles both the v4 "packed path" shape and the v2/v3/v5 raw-operator shape.
 */
function decodeConstructPath(args: any): DecodedPath | null {
  if (!args) return null;

  // ---- v4 style: [intent, [Float32Array|null], Float32Array|null] ----
  if (Array.isArray(args) && args.length >= 2 && Array.isArray(args[1])) {
    const packed = args[1][0];
    if (packed && (packed instanceof Float32Array || Array.isArray(packed))) {
      return decodePackedPathV4(packed as ArrayLike<number>);
    }
  }

  // ---- v2/v3/v5 style: [ops: number[], opArgs: any[]] ----
  if (Array.isArray(args) && args.length >= 2 && Array.isArray(args[0])) {
    const ops = args[0] as number[];
    const a = args[1] as any[];

    const subOps: number[] = [];
    const coords: number[] = [];

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const opArgs = a[i];
      if (!opArgs) continue;

      switch (op) {
        case pdfjs.OPS.moveTo: {
          subOps.push(PATH_OPS.moveTo);
          coords.push(opArgs[0], opArgs[1]);
          break;
        }
        case pdfjs.OPS.lineTo: {
          subOps.push(PATH_OPS.lineTo);
          coords.push(opArgs[0], opArgs[1]);
          break;
        }
        case pdfjs.OPS.curveTo: {
          subOps.push(PATH_OPS.curveTo);
          coords.push(
            opArgs[0], opArgs[1],
            opArgs[2], opArgs[3],
            opArgs[4], opArgs[5],
          );
          break;
        }
        case pdfjs.OPS.curveTo2: {
          subOps.push(PATH_OPS.curveTo2);
          coords.push(opArgs[0], opArgs[1], opArgs[2], opArgs[3]);
          break;
        }
        case pdfjs.OPS.curveTo3: {
          subOps.push(PATH_OPS.curveTo3);
          coords.push(opArgs[0], opArgs[1], opArgs[2], opArgs[3]);
          break;
        }
        case pdfjs.OPS.closePath: {
          subOps.push(PATH_OPS.closePath);
          break;
        }
        case pdfjs.OPS.rectangle: {
          subOps.push(PATH_OPS.rectangle);
          coords.push(opArgs[0], opArgs[1], opArgs[2], opArgs[3]);
          break;
        }
        default:
          break;
      }
    }

    if (subOps.length === 0) return null;
    return { subOps, coords };
  }

  return null;
}

/** Decode v4 packed-path format (0=move, 1=line, 2=cubic, 3=quad, 4=close). */
function decodePackedPathV4(data: ArrayLike<number>): DecodedPath {
  const subOps: number[] = [];
  const coords: number[] = [];

  let cx = 0, cy = 0, sx = 0, sy = 0;
  let i = 0;

  while (i < data.length) {
    const op = data[i++];
    switch (op) {
      case 0: {
        const x = data[i++]; const y = data[i++];
        subOps.push(PATH_OPS.moveTo); coords.push(x, y);
        cx = sx = x; cy = sy = y;
        break;
      }
      case 1: {
        const x = data[i++]; const y = data[i++];
        subOps.push(PATH_OPS.lineTo); coords.push(x, y);
        cx = x; cy = y;
        break;
      }
      case 2: {
        const x1 = data[i++], y1 = data[i++];
        const x2 = data[i++], y2 = data[i++];
        const x3 = data[i++], y3 = data[i++];
        subOps.push(PATH_OPS.curveTo); coords.push(x1, y1, x2, y2, x3, y3);
        cx = x3; cy = y3;
        break;
      }
      case 3: { // quadratic → cubic
        const qx = data[i++], qy = data[i++];
        const x = data[i++], y = data[i++];
        const x1 = cx + (2 / 3) * (qx - cx);
        const y1 = cy + (2 / 3) * (qy - cy);
        const x2 = x + (2 / 3) * (qx - x);
        const y2 = y + (2 / 3) * (qy - y);
        subOps.push(PATH_OPS.curveTo); coords.push(x1, y1, x2, y2, x, y);
        cx = x; cy = y;
        break;
      }
      case 4:
        subOps.push(PATH_OPS.closePath);
        cx = sx; cy = sy;
        break;
      default:
        throw new Error(`Unsupported packed path operator: ${op}`);
    }
  }

  return { subOps, coords };
}

// ─── Public processConstructPath ────────────────────────────────────────────

export function processConstructPath(
  subOps: number[],
  coords: number[],
  writer: DxfWriter,
  scale: number,
  matrix: Matrix2D = IDENTITY_MATRIX,
  stroke?: StrokeState,
): void {
  const paths = collectSubPaths(subOps, coords, scale, matrix);
  for (const sub of paths) {
    emitSubPath(sub, writer, stroke, matrix);
  }
}

// ─── Page processor ─────────────────────────────────────────────────────────

async function processPage(
  page: PDFPageProxy,
  writer: DxfWriter,
  pageIndex: number,
  opts: Required<ConvertOptions>,
  warnings: string[],
): Promise<void> {
  const layerName = `${opts.layerPrefix}_${pageIndex + 1}`;
  writer.addLayer(layerName, Colors.White, 'CONTINUOUS');
  writer.setCurrentLayerName(layerName);

  // ── Vector paths ─────────────────────────────────────────────────────────
  if (opts.includePaths) {
    try {
      const opList = await page.getOperatorList();
      const fnArray = opList.fnArray;
      const argsArray = opList.argsArray;
      let currentMatrix: Matrix2D = [...IDENTITY_MATRIX];
      const matrixStack: Matrix2D[] = [];

      let stroke: StrokeState = {};
      const strokeStack: StrokeState[] = [];

      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];
        const args = argsArray[i] as any;

        if (fn === pdfjs.OPS.save) {
          matrixStack.push([...currentMatrix]);
          strokeStack.push({ ...stroke });
          continue;
        }

        if (fn === pdfjs.OPS.restore) {
          const previous = matrixStack.pop();
          if (previous) currentMatrix = previous;
          const prevStroke = strokeStack.pop();
          if (prevStroke) stroke = prevStroke;
          continue;
        }

        if (fn === pdfjs.OPS.transform) {
          if (args && args.length >= 6) {
            currentMatrix = multiplyMatrices(currentMatrix, args as ArrayLike<number>);
          }
          continue;
        }

        if (fn === pdfjs.OPS.setStrokeRGBColor) {
          if (args && args.length >= 3) {
            const r = Number(args[0]);
            const g = Number(args[1]);
            const b = Number(args[2]);
            stroke.color = opts.preserveColors ? rgbToAci(r, g, b) : undefined;
          }
          continue;
        }

        if (fn === pdfjs.OPS.setLineWidth) {
          if (args && args.length >= 1) {
            const w = Number(args[0]);
            stroke.lineWidth = opts.preserveLineWidths ? w : undefined;
          }
          continue;
        }

        if (fn === pdfjs.OPS.paintFormXObjectBegin) {
          matrixStack.push([...currentMatrix]);
          strokeStack.push({ ...stroke });
          const formMatrix = args?.[0] as ArrayLike<number> | undefined;
          if (formMatrix && formMatrix.length >= 6) {
            currentMatrix = multiplyMatrices(currentMatrix, formMatrix);
          }
          continue;
        }

        if (fn === pdfjs.OPS.paintFormXObjectEnd) {
          const previous = matrixStack.pop();
          if (previous) currentMatrix = previous;
          const prevStroke = strokeStack.pop();
          if (prevStroke) stroke = prevStroke;
          continue;
        }

        if (fn === pdfjs.OPS.constructPath) {
          const decoded = decodeConstructPath(args);
          if (decoded && decoded.subOps.length > 0) {
            processConstructPath(
              decoded.subOps,
              decoded.coords,
              writer,
              opts.scale,
              [...currentMatrix],
              { ...stroke },
            );
          }
        }
      }
    } catch (err) {
      warnings.push(`Page ${pageIndex + 1}: path extraction failed — ${String(err)}`);
    }
  }

  // ── Text items ───────────────────────────────────────────────────────────
  if (opts.includeText) {
    try {
      const textContent = await page.getTextContent();
      for (const item of textContent.items) {
        if (!('str' in item) || !item.str.trim()) continue;

        const tx = item.transform[4];
        const ty = item.transform[5];
        const fontSize = Math.abs(item.transform[3]) || 12;
        const rotation = extractTextRotation(item.transform);

        const pos = pt(tx * opts.scale, ty * opts.scale);

        try {
          const opts2: any = {};
          if (Math.abs(rotation) > 1e-4) {
            opts2.rotation = (rotation * 180) / Math.PI;
          }
          if ('width' in item && item.width) {
            opts2.width = (item.width as number) * opts.scale;
          }
          if (Object.keys(opts2).length > 0) {
            (writer.addText as any)(pos, fontSize * opts.scale, item.str, opts2);
          } else {
            writer.addText(pos, fontSize * opts.scale, item.str);
          }
        } catch {
          writer.addText(pos, fontSize * opts.scale, item.str);
        }
      }
    } catch (err) {
      warnings.push(`Page ${pageIndex + 1}: text extraction failed — ${String(err)}`);
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Convert a PDF (supplied as an ArrayBuffer or Uint8Array) to a DXF string.
 * Runs entirely locally — no network requests are made.
 */
export async function convertPdfToDxf(
  data: ArrayBuffer | Uint8Array,
  options: ConvertOptions = {},
): Promise<ConvertResult> {
  const opts: Required<ConvertOptions> = {
    pages: options.pages ?? [],
    scale: options.scale ?? 1,
    layerPrefix: options.layerPrefix ?? 'PAGE',
    includeText: options.includeText ?? true,
    includePaths: options.includePaths ?? true,
    preserveColors: options.preserveColors ?? true,
    preserveLineWidths: options.preserveLineWidths ?? true,
  };

  const warnings: string[] = [];

  const loadingTask = pdfjs.getDocument({
    data: data instanceof ArrayBuffer ? new Uint8Array(data) : data,
  });
  const pdf: PDFDocumentProxy = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const pagesToProcess =
    opts.pages.length > 0
      ? opts.pages.filter((p) => p >= 1 && p <= totalPages)
      : Array.from({ length: totalPages }, (_, i) => i + 1);

  if (pagesToProcess.length === 0) {
    warnings.push('No valid pages to process.');
  }

  const writer = new DxfWriter();

  for (const pageNum of pagesToProcess) {
    const page = await pdf.getPage(pageNum);
    await processPage(page, writer, pageNum - 1, opts, warnings);
    page.cleanup();
  }

  return {
    dxf: writer.stringify(),
    pageCount: pagesToProcess.length,
    warnings,
  };
}
