/**
 * pdf-to-dxf — Core conversion engine
 * Part of the ek-mc civil toolset
 *
 * Strategy:
 *  1. Parse each PDF page with pdfjs-dist to extract vector paths and text.
 *  2. Translate each element into DXF entities using @tarikjabiri/dxf DxfWriter.
 *  3. Return the DXF string (or write to file in CLI mode).
 *
 * Notes on pdfjs v5:
 *  pdfjs v4+ batches all path sub-operations (moveTo, lineTo, curveTo, rectangle,
 *  closePath) into a single `constructPath` operator. The first argument is an
 *  array of sub-op codes, and the second argument is a flat array of coordinates.
 *
 * Coordinate mapping:
 *  PDF uses bottom-left origin; DXF (AutoCAD) also uses bottom-left — no flip needed.
 *  PDF units are points (1 pt = 1/72 inch). Preserved as-is; scale via the `scale` option.
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
  // PDF text rotation is atan2(b, a) for the x-axis direction
  return Math.atan2(b, a);
}

// ─── Path sub-op codes used by pdfjs constructPath ──────────────────────────
// These are the raw PDF operator codes embedded inside the constructPath batch.
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
  /** ACI color index, or undefined for "BYLAYER" default. */
  color?: number;
  /** Line width in pt (PDF units), or undefined if default. */
  lineWidth?: number;
}

/** Convert an RGB triple to the nearest ACI index using the standard palette. */
function rgbToAci(r: number, g: number, b: number): number {
  // Minimal mapping of the most common engineering colors.
  // Extend this table if you need finer fidelity.
  const palette: Array<[number, number, number, number]> = [
    [0, 0, 0, 0],       // 0 – BYBLOCK (unused here)
    [255, 0, 0, 1],     // 1 – red
    [255, 255, 0, 2],   // 2 – yellow
    [0, 255, 0, 3],     // 3 – green
    [0, 255, 255, 4],   // 4 – cyan
    [0, 0, 255, 5],     // 5 – blue
    [255, 0, 255, 6],   // 6 – magenta
    [255, 255, 255, 7], // 7 – white/black
  ];
  // Normalize inputs to 0..255
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

/** Clamp a PDF line width (pt) into a sensible DXF lineweight (hundredths of mm). */
function ptToLineweight(ptWidth: number): number {
  // 1 pt = 1/72 inch ≈ 0.3528 mm → 0.3528 * 100 = 35.28 hundredths of mm
  const hundredthsMm = Math.round(ptWidth * 35.28);
  // Standard DXF lineweights; snap to nearest.
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
//
// Replaces the old fixed-step approximation with a recursive De Casteljau
// subdivision approach. The curve is split until the maximum distance from
// the chord (chordal deviation) is below `tolerance`. This produces smooth
// output for large curves and minimal segments for near-straight ones.
//
// tolerance: maximum allowed deviation in DXF units (default: 0.5 pt ≈ 0.18mm)
// maxDepth:  recursion guard to prevent stack overflow on degenerate curves

const BEZIER_TOLERANCE = 0.5;
const BEZIER_MAX_DEPTH = 12;

function chordalDeviation(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): number {
  // Maximum distance of the two inner control points from the chord p0→p3.
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // Degenerate chord: use distance from p0
    const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const d2 = Math.hypot(p2.x - p0.x, p2.y - p0.y);
    return Math.max(d1, d2);
  }
  const cross1 = Math.abs(dx * (p0.y - p1.y) - dy * (p0.x - p1.x)) / Math.sqrt(lenSq);
  const cross2 = Math.abs(dx * (p0.y - p2.y) - dy * (p0.x - p2.x)) / Math.sqrt(lenSq);
  return Math.max(cross1, cross2);
}

/**
 * Adaptively subdivide a cubic Bézier curve and emit LINE entities.
 * Produces far fewer segments for straight/near-straight sections and
 * more segments only where the curve actually bends.
 */
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
    // Flat enough — emit a single line segment (skip if zero-length)
    emitLine(writer, p0, p3, stroke);
    return;
  }

  // De Casteljau split at t=0.5
  const m01 = pt((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
  const m12 = pt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
  const m23 = pt((p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
  const m012 = pt((m01.x + m12.x) / 2, (m01.y + m12.y) / 2);
  const m123 = pt((m12.x + m23.x) / 2, (m12.y + m23.y) / 2);
  const mid = pt((m012.x + m123.x) / 2, (m012.y + m123.y) / 2);

  approximateBezierAdaptive(p0, m01, m012, mid, writer, tolerance, depth + 1, stroke);
  approximateBezierAdaptive(mid, m123, m23, p3, writer, tolerance, depth + 1, stroke);
}

// ─── Line emitter with stroke filtering + color/lineweight ──────────────────

/**
 * Emit a DXF line, skipping zero-length segments and applying stroke styling.
 * The DxfWriter API varies between versions; we pass an options object where
 * supported, and gracefully fall back to the basic signature otherwise.
 */
function emitLine(writer: DxfWriter, a: Vec3, b: Vec3, stroke?: StrokeState): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx * dx + dy * dy < 1e-12) return; // skip zero-length

  try {
    // @tarikjabiri/dxf v3+ supports an options object as 3rd argument.
    // If your version ignores it, the line is still drawn correctly.
    const opts: any = {};
    if (stroke?.color !== undefined) opts.color = stroke.color;
    if (stroke?.lineWidth !== undefined) opts.lineWeight = ptToLineweight(stroke.lineWidth);
    if (Object.keys(opts).length > 0) {
      (writer.addLine as any)(a, b, opts);
    } else {
      writer.addLine(a, b);
    }
  } catch {
    // Fallback for stricter typings / older versions
    writer.addLine(a, b);
  }
}

// ─── Circle / Arc fitting ────────────────────────────────────────────────────
//
// A PDF circle is encoded as 4 cubic Bézier curves (one per quadrant).
// Each quadrant uses the standard kappa approximation factor ≈ 0.5523.
// We detect this pattern in a closed sub-path and, when confirmed, emit a
// true DXF CIRCLE entity instead of 32+ line segments.
//
// Detection strategy:
//  1. Collect all Bézier control points for a closed sub-path.
//  2. If there are exactly 4 curveTo ops, attempt a least-squares circle fit
//     on the 4 anchor points (start of each curve).
//  3. Accept the fit if the residual is below CIRCLE_FIT_TOLERANCE AND
//     the kappa ratio of each quadrant is close to 0.5523.

const CIRCLE_FIT_TOLERANCE = 0.15;          // tighter than before (was 0.5)
const CIRCLE_FIT_RADIUS_MIN = 1.0;          // pt — reject tiny circles
const CIRCLE_FIT_RADIUS_MAX_RATIO = 0.5;    // fraction of page width (checked later)
const KAPPA = 0.5522847498;
const KAPPA_TOLERANCE = 0.05;               // ±5% on control-point ratio

interface SubPath {
  ops: Array<
    | { type: 'line'; to: Vec3 }
    | { type: 'curve'; p1: Vec3; p2: Vec3; p3: Vec3; isCurveTo2?: boolean }
  >;
  start: Vec3;
  closed: boolean;
}

/**
 * Fit a circle through 3+ points using the algebraic least-squares method.
 * Returns { cx, cy, r } or null if the points are collinear / too few.
 */
function fitCircle(points: Vec3[]): { cx: number; cy: number; r: number } | null {
  if (points.length < 3) return null;

  // Build the linear system: (x-cx)^2 + (y-cy)^2 = r^2
  // Rearranged: 2*cx*x + 2*cy*y + (r^2 - cx^2 - cy^2) = x^2 + y^2
  // Let c = r^2 - cx^2 - cy^2 → solve [2x, 2y, 1] * [cx, cy, c]^T = x^2+y^2
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
  if (Math.abs(det) < 1e-10) return null; // collinear

  const cx = (D * C - B * E) / det;
  const cy = (A * E - B * D) / det;
  const r = Math.sqrt((sumX2 + sumY2 - 2 * cx * sumX - 2 * cy * sumY) / n + cx * cx + cy * cy);

  if (!isFinite(r) || r <= 0) return null;
  return { cx, cy, r };
}

/**
 * Check if a closed sub-path with exactly 4 curveTo ops is a circle.
 * Returns { cx, cy, r } if it is, or null otherwise.
 */
function tryFitCircleFromSubPath(
  sub: SubPath,
): { cx: number; cy: number; r: number } | null {
  if (!sub.closed) return null;

  const curves = sub.ops.filter((o) => o.type === 'curve');
  if (curves.length !== 4) return null;

  // Anchor points: start of sub-path + p3 of each curve
  const anchors: Vec3[] = [sub.start];
  for (const op of sub.ops) {
    if (op.type === 'curve') anchors.push(op.p3);
  }
  // anchors[4] === anchors[0] (closed), so use first 4
  const pts = anchors.slice(0, 4);

  const fit = fitCircle(pts);
  if (!fit) return null;

  // Radius bounds
  if (fit.r < CIRCLE_FIT_RADIUS_MIN) return null;

  // Validate: all anchor points must be within tolerance of the fitted circle
  for (const p of pts) {
    const dist = Math.abs(Math.hypot(p.x - fit.cx, p.y - fit.cy) - fit.r);
    if (dist > CIRCLE_FIT_TOLERANCE) return null;
  }

  // Validate kappa ratio: for each quadrant, the distance from anchor to
  // its control points should be ≈ KAPPA * r.
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

// ─── Sub-path collector ───────────────────────────────────────────────────────
//
// We first collect sub-paths from the constructPath batch, then decide per
// sub-path whether to emit a CIRCLE entity or fall back to line/curve output.

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
        // Explicit flag instead of coordinate sentinel — robust to coincident points.
        const p2 = map(coords[ci], coords[ci + 1]);
        const p3 = map(coords[ci + 2], coords[ci + 3]);
        ci += 4;
        if (current) {
          current.ops.push({ type: 'curve', p1: p3, p2, p3, isCurveTo2: true });
        }
        break;
      }

      case PATH_OPS.curveTo3: {
        const p1 = map(coords[ci], coords[ci + 1]);
        const p3 = map(coords[ci + 2], coords[ci + 3]);
        ci += 4;
        if (current) current.ops.push({ type: 'curve', p1, p2: p3, p3 });
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

// ─── Sub-path emitter ─────────────────────────────────────────────────────────

function emitSubPath(sub: SubPath, writer: DxfWriter, stroke?: StrokeState): void {
  // Attempt circle detection first
  const circle = tryFitCircleFromSubPath(sub);
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

  // Fall back to adaptive line/curve emission
  let pos = sub.start;

  for (const op of sub.ops) {
    if (op.type === 'line') {
      emitLine(writer, pos, op.to, stroke);
      pos = op.to;
    } else {
      // curveTo2 uses explicit flag now — no coordinate comparison
      const p1 = op.isCurveTo2 ? pos : op.p1;
      approximateBezierAdaptive(pos, p1, op.p2, op.p3, writer, BEZIER_TOLERANCE, 0, stroke);
      pos = op.p3;
    }
  }

  if (sub.closed && (pos.x !== sub.start.x || pos.y !== sub.start.y)) {
    emitLine(writer, pos, sub.start, stroke);
  }
}

// ─── Process a constructPath batch ──────────────────────────────────────────

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
    emitSubPath(sub, writer, stroke);
  }
}

function processPackedPath(
  data: ArrayLike<number>,
  writer: DxfWriter,
  scale: number,
  matrix: Matrix2D = IDENTITY_MATRIX,
  stroke?: StrokeState,
): void {
  const subOps: number[] = [];
  const coords: number[] = [];

  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  let i = 0;

  while (i < data.length) {
    const op = data[i++];

    switch (op) {
      case 0: {
        const x = data[i++];
        const y = data[i++];
        subOps.push(PATH_OPS.moveTo);
        coords.push(x, y);
        currentX = startX = x;
        currentY = startY = y;
        break;
      }

      case 1: {
        const x = data[i++];
        const y = data[i++];
        subOps.push(PATH_OPS.lineTo);
        coords.push(x, y);
        currentX = x;
        currentY = y;
        break;
      }

      case 2: {
        const x1 = data[i++];
        const y1 = data[i++];
        const x2 = data[i++];
        const y2 = data[i++];
        const x3 = data[i++];
        const y3 = data[i++];
        subOps.push(PATH_OPS.curveTo);
        coords.push(x1, y1, x2, y2, x3, y3);
        currentX = x3;
        currentY = y3;
        break;
      }

      case 3: {
        const qx = data[i++];
        const qy = data[i++];
        const x = data[i++];
        const y = data[i++];

        const x1 = currentX + (2 / 3) * (qx - currentX);
        const y1 = currentY + (2 / 3) * (qy - currentY);
        const x2 = x + (2 / 3) * (qx - x);
        const y2 = y + (2 / 3) * (qy - y);

        subOps.push(PATH_OPS.curveTo);
        coords.push(x1, y1, x2, y2, x, y);
        currentX = x;
        currentY = y;
        break;
      }

      case 4: {
        subOps.push(PATH_OPS.closePath);
        currentX = startX;
        currentY = startY;
        break;
      }

      default:
        throw new Error(`Unsupported packed path operator: ${op}`);
    }
  }

  processConstructPath(subOps, coords, writer, scale, matrix, stroke);
}

// ─── Page processor ─────────────────────────────────────────────────────────

async function processPage(
  page: PDFPageProxy,
  writer: DxfWriter,
  pageIndex: number,
  opts: Required<ConvertOptions>,
  warnings: string[]
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

      // Stroke state — tracked sequentially and restored with matrix stack
      let stroke: StrokeState = {};
      const strokeStack: StrokeState[] = [];

      // PDF graphics state is sequential: transforms must be accumulated in
      // order and restored when the matching save/restore operators occur.
      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];
        const args = argsArray[i] as ArrayLike<unknown> | undefined;

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

        // ── Stroke color ────────────────────────────────────────────────
        if (fn === pdfjs.OPS.setStrokeRGBColor) {
          if (args && args.length >= 3) {
            const r = Number(args[0]);
            const g = Number(args[1]);
            const b = Number(args[2]);
            stroke.color = opts.preserveColors ? rgbToAci(r, g, b) : undefined;
          }
          continue;
        }

        // ── Line width ──────────────────────────────────────────────────
        if (fn === pdfjs.OPS.setLineWidth) {
          if (args && args.length >= 1) {
            const w = Number(args[0]);
            stroke.lineWidth = opts.preserveLineWidths ? w : undefined;
          }
          continue;
        }

        // Form XObjects can introduce their own matrix in the operator list.
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

        // pdfjs v5 batches path sub-operations into constructPath.
        if (fn === pdfjs.OPS.constructPath) {
          const pathArgs = args as
            | [number, [Float32Array | null], Float32Array | null]
            | undefined;
          const packedPath = pathArgs?.[1]?.[0];
          if (packedPath) {
            processPackedPath(
              packedPath,
              writer,
              opts.scale,
              [...currentMatrix],
              { ...stroke }
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
            opts2.rotation = (rotation * 180) / Math.PI; // DXF expects degrees
          }
          // Basic alignment: use the text's own width/height hints when present
          // (pdfjs provides `width` and `height` on text items).
          // This improves insertion-point accuracy for center/right-aligned text.
          if ('width' in item && item.width) {
            opts2.width = item.width * opts.scale;
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
  options: ConvertOptions = {}
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
