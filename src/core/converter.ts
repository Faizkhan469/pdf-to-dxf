/**
 * pdf-to-dxf — Core conversion engine
 * Part of the ek-mc civil toolset
 */

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { DxfWriter, Colors, point3d } from '@tarikjabiri/dxf';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export interface ConvertOptions {
  pages?: number[];
  scale?: number;
  layerPrefix?: string;
  includeText?: boolean;
  includePaths?: boolean;
  preserveColors?: boolean;
  preserveLineWidths?: boolean;
  recognizeCirclesFromPolylines?: boolean;
}

export interface ConvertResult {
  dxf: string;
  pageCount: number;
  warnings: string[];
}

type Vec3 = { x: number; y: number; z: number };
type Matrix2D = [number, number, number, number, number, number];

const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0];

function pt(x: number, y: number): Vec3 {
  return point3d(x, y, 0);
}

function transformPoint(x: number, y: number, matrix: Matrix2D, scale: number): Vec3 {
  const [a, b, c, d, e, f] = matrix;
  return pt((a * x + c * y + e) * scale, (b * x + d * y + f) * scale);
}

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

function extractTextRotation(m: ArrayLike<number>): number {
  return Math.atan2(Number(m[1]), Number(m[0]));
}

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

const PATH_OPS = {
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
} as const;

interface StrokeState {
  color?: number;
  lineWidth?: number;
}

function rgbToAci(r: number, g: number, b: number): number {
  const palette: Array<[number, number, number, number]> = [
    [255, 0, 0, 1],
    [255, 255, 0, 2],
    [0, 255, 0, 3],
    [0, 255, 255, 4],
    [0, 0, 255, 5],
    [255, 0, 255, 6],
    [255, 255, 255, 7],
  ];
  const R = Math.round(r * 255);
  const G = Math.round(g * 255);
  const B = Math.round(b * 255);
  let best = 7;
  let bestDist = Infinity;
  for (const [pr, pg, pb, aci] of palette) {
    const d = (R - pr) ** 2 + (G - pg) ** 2 + (B - pb) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = aci;
    }
  }
  return best;
}

function ptToLineweight(ptWidth: number): number {
  const hundredthsMm = Math.round(ptWidth * 35.28);
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
  p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3,
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

function emitCircle(writer: DxfWriter, cx: number, cy: number, r: number, stroke?: StrokeState): void {
  try {
    const opts: any = {};
    if (stroke?.color !== undefined) opts.color = stroke.color;
    if (stroke?.lineWidth !== undefined) opts.lineWeight = ptToLineweight(stroke.lineWidth);
    if (Object.keys(opts).length > 0) {
      (writer.addCircle as any)(pt(cx, cy), r, opts);
    } else {
      writer.addCircle(pt(cx, cy), r);
    }
  } catch {
    writer.addCircle(pt(cx, cy), r);
  }
}

const CIRCLE_FIT_TOLERANCE = 0.15;
const CIRCLE_FIT_RADIUS_MIN = 1.0;
const KAPPA = 0.5522847498;
const KAPPA_TOLERANCE = 0.05;

const POLYLINE_CIRCLE_MIN_VERTICES = 12;
const POLYLINE_CIRCLE_MAX_DEVIATION = 0.5;
const POLYLINE_CIRCLE_RADIUS_MIN = 2.0;
const POLYLINE_CIRCLE_MAX_RADIUS_RATIO = 0.45;

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

function tryFitCircleFromBeziers(
  sub: SubPath,
  similarity: boolean,
): { cx: number; cy: number; r: number } | null {
  if (!similarity) return null;
  if (!sub.closed) return null;
  const curves = sub.ops.filter((o) => o.type === 'curve');
  if (curves.length !== 4) return null;
  if (curves.some((c: any) => c.isCurveTo2)) return null;
  const anchors: Vec3[] = [sub.start];
  for (const op of sub.ops) if (op.type === 'curve') anchors.push(op.p3);
  const pts = anchors.slice(0, 4);
  const fit = fitCircle(pts);
  if (!fit) return null;
  if (fit.r < CIRCLE_FIT_RADIUS_MIN) return null;
  for (const p of pts) {
    const dist = Math.abs(Math.hypot(p.x - fit.cx, p.y - fit.cy) - fit.r);
    if (dist > CIRCLE_FIT_TOLERANCE) return null;
  }
  let pos = sub.start;
  for (const op of sub.ops) {
    if (op.type !== 'curve') continue;
    const d1 = Math.hypot(op.p1.x - pos.x, op.p1.y - pos.y);
    const d2 = Math.hypot(op.p2.x - op.p3.x, op.p2.y - op.p3.y);
    const expected = KAPPA * fit.r;
    if (
      Math.abs(d1 - expected) / expected > KAPPA_TOLERANCE ||
      Math.abs(d2 - expected) / expected > KAPPA_TOLERANCE
    ) return null;
    pos = op.p3;
  }
  return fit;
}

function tryFitCircleFromPolyline(
  sub: SubPath,
  pageDiagonal: number,
): { cx: number; cy: number; r: number } | null {
  if (!sub.closed) return null;
  if (sub.ops.length < POLYLINE_CIRCLE_MIN_VERTICES) return null;
  if (sub.ops.some((o) => o.type !== 'line')) return null;
  const verts: Vec3[] = [sub.start];
  for (const op of sub.ops) if (op.type === 'line') verts.push(op.to);
  if (verts.length > 1) {
    const first = verts[0];
    const last = verts[verts.length - 1];
    if (Math.abs(last.x - first.x) < 1e-6 && Math.abs(last.y - first.y) < 1e-6) {
      verts.pop();
    }
  }
  if (verts.length < POLYLINE_CIRCLE_MIN_VERTICES) return null;
  const fit = fitCircle(verts);
  if (!fit) return null;
  if (fit.r < POLYLINE_CIRCLE_RADIUS_MIN) return null;
  if (fit.r > pageDiagonal * POLYLINE_CIRCLE_MAX_RADIUS_RATIO) return null;
  for (const v of verts) {
    const dev = Math.abs(Math.hypot(v.x - fit.cx, v.y - fit.cy) - fit.r);
    if (dev > POLYLINE_CIRCLE_MAX_DEVIATION) return null;
  }
  return fit;
}

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
        const p = map(coords[ci], coords[ci + 1]); ci += 2;
        current = { ops: [], start: p, closed: false };
        paths.push(current);
        break;
      }
      case PATH_OPS.lineTo: {
        const to = map(coords[ci], coords[ci + 1]); ci += 2;
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
        const p2 = map(coords[ci], coords[ci + 1]);
        const p3 = map(coords[ci + 2], coords[ci + 3]);
        ci += 4;
        if (current) current.ops.push({ type: 'curve', p1: p3, p2, p3, isCurveTo2: true });
        break;
      }
      case PATH_OPS.curveTo3: {
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
        const rx = coords[ci], ry = coords[ci + 1];
        const rw = coords[ci + 2], rh = coords[ci + 3];
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

function emitSubPath(
  sub: SubPath,
  writer: DxfWriter,
  stroke: StrokeState | undefined,
  matrix: Matrix2D,
  pageDiagonal: number,
  recognizePolylines: boolean,
): void {
  const similarity = isSimilarityMatrix(matrix);
  const bezierCircle = tryFitCircleFromBeziers(sub, similarity);
  if (bezierCircle) {
    emitCircle(writer, bezierCircle.cx, bezierCircle.cy, bezierCircle.r, stroke);
    return;
  }
  if (recognizePolylines) {
    const polyCircle = tryFitCircleFromPolyline(sub, pageDiagonal);
    if (polyCircle) {
      emitCircle(writer, polyCircle.cx, polyCircle.cy, polyCircle.r, stroke);
      return;
    }
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
    if (gx * gx + gy * gy >= 1e-9) emitLine(writer, pos, sub.start, stroke);
  }
}

interface DecodedPath {
  subOps: number[];
  coords: number[];
}

function decodeConstructPath(args: any): DecodedPath | null {
  if (!args) return null;
  if (Array.isArray(args) && args.length >= 2 && Array.isArray(args[1])) {
    const packed = args[1][0];
    if (packed && (packed instanceof Float32Array || Array.isArray(packed))) {
      return decodePackedPathV4(packed as ArrayLike<number>);
    }
  }
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
        case pdfjs.OPS.moveTo:
          subOps.push(PATH_OPS.moveTo); coords.push(opArgs[0], opArgs[1]); break;
        case pdfjs.OPS.lineTo:
          subOps.push(PATH_OPS.lineTo); coords.push(opArgs[0], opArgs[1]); break;
        case pdfjs.OPS.curveTo:
          subOps.push(PATH_OPS.curveTo);
          coords.push(opArgs[0], opArgs[1], opArgs[2], opArgs[3], opArgs[4], opArgs[5]);
          break;
        case pdfjs.OPS.curveTo2:
          subOps.push(PATH_OPS.curveTo2);
          coords.push(opArgs[0], opArgs[1], opArgs[2], opArgs[3]);
          break;
        case pdfjs.OPS.curveTo3:
          subOps.push(PATH_OPS.curveTo3);
          coords.push(opArgs[0], opArgs[1], opArgs[2], opArgs[3]);
          break;
        case pdfjs.OPS.closePath:
          subOps.push(PATH_OPS.closePath); break;
        case pdfjs.OPS.rectangle:
          subOps.push(PATH_OPS.rectangle);
          coords.push(opArgs[0], opArgs[1], opArgs[2], opArgs[3]);
          break;
        default: break;
      }
    }
    if (subOps.length === 0) return null;
    return { subOps, coords };
  }
  return null;
}

function decodePackedPathV4(data: ArrayLike<number>): DecodedPath {
  const subOps: number[] = [];
  const coords: number[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let i = 0;
  while (i < data.length) {
    const op = data[i++];
    switch (op) {
      case 0: {
        const x = data[i++], y = data[i++];
        subOps.push(PATH_OPS.moveTo); coords.push(x, y);
        cx = sx = x; cy = sy = y; break;
      }
      case 1: {
        const x = data[i++], y = data[i++];
        subOps.push(PATH_OPS.lineTo); coords.push(x, y);
        cx = x; cy = y; break;
      }
      case 2: {
        const x1 = data[i++], y1 = data[i++];
        const x2 = data[i++], y2 = data[i++];
        const x3 = data[i++], y3 = data[i++];
        subOps.push(PATH_OPS.curveTo); coords.push(x1, y1, x2, y2, x3, y3);
        cx = x3; cy = y3; break;
      }
      case 3: {
        const qx = data[i++], qy = data[i++];
        const x = data[i++], y = data[i++];
        const x1 = cx + (2 / 3) * (qx - cx);
        const y1 = cy + (2 / 3) * (qy - cy);
        const x2 = x + (2 / 3) * (qx - x);
        const y2 = y + (2 / 3) * (qy - y);
        subOps.push(PATH_OPS.curveTo); coords.push(x1, y1, x2, y2, x, y);
        cx = x; cy = y; break;
      }
      case 4:
        subOps.push(PATH_OPS.closePath); cx = sx; cy = sy; break;
      default:
        throw new Error(`Unsupported packed path operator: ${op}`);
    }
  }
  return { subOps, coords };
}

export function processConstructPath(
  subOps: number[],
  coords: number[],
  writer: DxfWriter,
  scale: number,
  matrix: Matrix2D = IDENTITY_MATRIX,
  stroke?: StrokeState,
  pageDiagonal = 1000,
  recognizePolylines = true,
): void {
  const paths = collectSubPaths(subOps, coords, scale, matrix);
  for (const sub of paths) {
    emitSubPath(sub, writer, stroke, matrix, pageDiagonal, recognizePolylines);
  }
}

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

  const vp = page.getViewport({ scale: 1 });
  const pageDiagonal = Math.hypot(vp.width, vp.height) * opts.scale;

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
          const p = matrixStack.pop(); if (p) currentMatrix = p;
          const s = strokeStack.pop(); if (s) stroke = s;
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
            stroke.color = opts.preserveColors
              ? rgbToAci(Number(args[0]), Number(args[1]), Number(args[2]))
              : undefined;
          }
          continue;
        }
        if (fn === pdfjs.OPS.setLineWidth) {
          if (args && args.length >= 1) {
            stroke.lineWidth = opts.preserveLineWidths ? Number(args[0]) : undefined;
          }
          continue;
        }
        if (fn === pdfjs.OPS.paintFormXObjectBegin) {
          matrixStack.push([...currentMatrix]);
          strokeStack.push({ ...stroke });
          const fm = args?.[0] as ArrayLike<number> | undefined;
          if (fm && fm.length >= 6) {
            currentMatrix = multiplyMatrices(currentMatrix, fm);
          }
          continue;
        }
        if (fn === pdfjs.OPS.paintFormXObjectEnd) {
          const p = matrixStack.pop(); if (p) currentMatrix = p;
          const s = strokeStack.pop(); if (s) stroke = s;
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
              pageDiagonal,
              opts.recognizeCirclesFromPolylines,
            );
          }
        }
      }
    } catch (err) {
      warnings.push(`Page ${pageIndex + 1}: path extraction failed — ${String(err)}`);
    }
  }

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
          const o: any = {};
          if (Math.abs(rotation) > 1e-4) o.rotation = (rotation * 180) / Math.PI;
          if ('width' in item && item.width) o.width = (item.width as number) * opts.scale;
          if (Object.keys(o).length > 0) {
            (writer.addText as any)(pos, fontSize * opts.scale, item.str, o);
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
    recognizeCirclesFromPolylines: options.recognizeCirclesFromPolylines ?? true,
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

  if (pagesToProcess.length === 0) warnings.push('No valid pages to process.');

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
