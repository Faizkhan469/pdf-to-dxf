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
  curveTolerance?: number;
}

export interface ConvertResult {
  dxf: string;
  pageCount: number;
  warnings: string[];
}

type Vec3 = { x: number; y: number; z: number };
type Mat = [number, number, number, number, number, number];

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function pt(x: number, y: number): Vec3 {
  return point3d(x, y, 0);
}

function multiply(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMatrix(m: Mat, x: number, y: number): Vec3 {
  return pt(
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  );
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

interface SubPath {
  ops: Array<
    | { type: 'line'; to: Vec3 }
    | { type: 'curve'; p1: Vec3; p2: Vec3; p3: Vec3 }
  >;
  start: Vec3;
  closed: boolean;
}

function chordalDeviation(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
): number {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.max(
      Math.hypot(p1.x - p0.x, p1.y - p0.y),
      Math.hypot(p2.x - p0.x, p2.y - p0.y),
    );
  }

  const d1 =
    Math.abs(dx * (p0.y - p1.y) - dy * (p0.x - p1.x)) /
    Math.sqrt(lenSq);

  const d2 =
    Math.abs(dx * (p0.y - p2.y) - dy * (p0.x - p2.x)) /
    Math.sqrt(lenSq);

  return Math.max(d1, d2);
}

function bezierPoints(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  tolerance: number,
  depth = 0,
): Vec3[] {
  if (
    depth >= 16 ||
    chordalDeviation(p0, p1, p2, p3) <= tolerance
  ) {
    return [p3];
  }

  const m01 = pt(
    (p0.x + p1.x) / 2,
    (p0.y + p1.y) / 2,
  );
  const m12 = pt(
    (p1.x + p2.x) / 2,
    (p1.y + p2.y) / 2,
  );
  const m23 = pt(
    (p2.x + p3.x) / 2,
    (p2.y + p3.y) / 2,
  );

  const m012 = pt(
    (m01.x + m12.x) / 2,
    (m01.y + m12.y) / 2,
  );
  const m123 = pt(
    (m12.x + m23.x) / 2,
    (m12.y + m23.y) / 2,
  );

  const mid = pt(
    (m012.x + m123.x) / 2,
    (m012.y + m123.y) / 2,
  );

  return [
    ...bezierPoints(p0, m01, m012, mid, tolerance, depth + 1),
    ...bezierPoints(mid, m123, m23, p3, tolerance, depth + 1),
  ];
}

function simplifyPoints(points: Vec3[], tolerance: number): Vec3[] {
  if (points.length <= 2) return points;

  const keep: boolean[] = new Array(points.length).fill(true);

  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];

    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const len = Math.hypot(dx, dy);

    if (len === 0) {
      keep[i] = false;
      continue;
    }

    const distance =
      Math.abs(dx * (a.y - b.y) - dy * (a.x - b.x)) / len;

    if (distance <= tolerance) {
      keep[i] = false;
    }
  }

  return points.filter((_, i) => keep[i]);
}

function fitCircle(points: Vec3[]): {
  cx: number;
  cy: number;
  r: number;
} | null {
  if (points.length < 3) return null;

  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;

  for (const p of points) {
    const x = p.x;
    const y = p.y;
    const z = x * x + y * y;

    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }

  const n = points.length;

  const a = sxx;
  const b = sxy;
  const c = sx;
  const d = sxy;
  const e = syy;
  const f = sy;
  const g = sx;
  const h = sy;
  const i = n;

  const determinant =
    a * (e * i - f * h) -
    b * (d * i - f * g) +
    c * (d * h - e * g);

  if (Math.abs(determinant) < 1e-9) return null;

  const j = sxz;
  const k = syz;
  const l = sz;

  const cx =
    (
      j * (e * i - f * h) -
      b * (k * i - f * l) +
      c * (k * h - e * l)
    ) / determinant;

  const cy =
    (
      a * (k * i - f * l) -
      j * (d * i - f * g) +
      c * (d * l - k * g)
    ) / determinant;

  const r =
    Math.sqrt(
      Math.max(
        0,
        (sxx - 2 * cx * sx + n * cx * cx +
          syy - 2 * cy * sy + n * cy * cy) / n,
      ),
    );

  if (!isFinite(r) || r <= 0) return null;

  return { cx, cy, r };
}

function circleResidual(
  points: Vec3[],
  circle: { cx: number; cy: number; r: number },
): number {
  let max = 0;

  for (const p of points) {
    const distance = Math.hypot(
      p.x - circle.cx,
      p.y - circle.cy,
    );

    max = Math.max(
      max,
      Math.abs(distance - circle.r),
    );
  }

  return max;
}

function sampleSubPath(sub: SubPath, tolerance: number): Vec3[] {
  const samples: Vec3[] = [sub.start];
  let current = sub.start;

  for (const op of sub.ops) {
    if (op.type === 'line') {
      samples.push(op.to);
      current = op.to;
    } else {
      const points = bezierPoints(
        current,
        op.p1,
        op.p2,
        op.p3,
        tolerance,
      );

      samples.push(...points);
      current = op.p3;
    }
  }

  return samples;
}

function detectCircleOrArc(
  sub: SubPath,
  tolerance: number,
): {
  circle: { cx: number; cy: number; r: number };
  samples: Vec3[];
} | null {
  const samples = sampleSubPath(sub, tolerance);

  if (samples.length < 6) return null;

  const circle = fitCircle(samples);

  if (!circle) return null;

  const allowed = Math.max(
    tolerance,
    circle.r * 0.02,
  );

  if (circleResidual(samples, circle) > allowed) {
    return null;
  }

  return { circle, samples };
}

function emitArc(
  sub: SubPath,
  writer: DxfWriter,
  circle: { cx: number; cy: number; r: number },
  samples: Vec3[],
): void {
  const start = sub.start;
  const end = samples[samples.length - 1];

  const startAngle =
    Math.atan2(
      start.y - circle.cy,
      start.x - circle.cx,
    );

  const endAngle =
    Math.atan2(
      end.y - circle.cy,
      end.x - circle.cx,
    );

  let direction = 0;

  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];

    direction +=
      (b.x - circle.cx) * (a.y - circle.cy) -
      (a.x - circle.cx) * (b.y - circle.cy);
  }

  const counterClockwise = direction > 0;

  const from = counterClockwise ? startAngle : endAngle;
  const to = counterClockwise ? endAngle : startAngle;

  writer.addArc(
    pt(circle.cx, circle.cy),
    circle.r,
    (from * 180) / Math.PI,
    (to * 180) / Math.PI,
  );
}

function emitSubPath(
  sub: SubPath,
  writer: DxfWriter,
  tolerance: number,
): void {
  const detected = detectCircleOrArc(sub, tolerance);

  if (detected) {
    const { circle, samples } = detected;

    if (sub.closed) {
      writer.addCircle(
        pt(circle.cx, circle.cy),
        circle.r,
      );
      return;
    }

    emitArc(sub, writer, circle, samples);
    return;
  }

  const points: Vec3[] = [sub.start];
  let current = sub.start;

  for (const op of sub.ops) {
    if (op.type === 'line') {
      points.push(op.to);
      current = op.to;
    } else {
      const curve = bezierPoints(
        current,
        op.p1,
        op.p2,
        op.p3,
        tolerance,
      );

      points.push(...curve);
      current = op.p3;
    }
  }

  if (sub.closed) {
    points.push(sub.start);
  }

  const simplified = simplifyPoints(points, tolerance / 2);

  for (let i = 1; i < simplified.length; i++) {
    writer.addLine(
      simplified[i - 1],
      simplified[i],
    );
  }
}

function collectSubPaths(
  data: ArrayLike<number>,
  scale: number,
  matrix: Mat,
): SubPath[] {
  const paths: SubPath[] = [];
  let current: SubPath | null = null;

  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  let i = 0;

  const map = (x: number, y: number): Vec3 => {
    const transformed = applyMatrix(matrix, x, y);
    return pt(
      transformed.x * scale,
      transformed.y * scale,
    );
  };

  while (i < data.length) {
    const op = data[i++];

    switch (op) {
      case 0: {
        const x = data[i++];
        const y = data[i++];

        const point = map(x, y);

        current = {
          ops: [],
          start: point,
          closed: false,
        };

        paths.push(current);

        currentX = x;
        currentY = y;
        startX = x;
        startY = y;

        break;
      }

      case 1: {
        const x = data[i++];
        const y = data[i++];

        if (current) {
          current.ops.push({
            type: 'line',
            to: map(x, y),
          });
        }

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

        if (current) {
          current.ops.push({
            type: 'curve',
            p1: map(x1, y1),
            p2: map(x2, y2),
            p3: map(x3, y3),
          });
        }

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

        if (current) {
          current.ops.push({
            type: 'curve',
            p1: map(x1, y1),
            p2: map(x2, y2),
            p3: map(x, y),
          });
        }

        currentX = x;
        currentY = y;

        break;
      }

      case 4: {
        if (current) {
          current.closed = true;
        }

        currentX = startX;
        currentY = startY;

        break;
      }

      default:
        break;
    }
  }

  return paths;
}

function processPackedPath(
  data: ArrayLike<number>,
  writer: DxfWriter,
  scale: number,
  matrix: Mat,
  tolerance: number,
): void {
  const paths = collectSubPaths(
    data,
    scale,
    matrix,
  );

  for (const sub of paths) {
    emitSubPath(sub, writer, tolerance);
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

  writer.addLayer(
    layerName,
    Colors.White,
    'CONTINUOUS',
  );

  writer.setCurrentLayerName(layerName);

  if (opts.includePaths) {
    try {
      const opList = await page.getOperatorList();
      const fnArray = opList.fnArray;
      const argsArray = opList.argsArray;

      let matrix: Mat = IDENTITY;
      const stack: Mat[] = [];

      const tolerance =
        (opts.curveTolerance ?? 0.25) * opts.scale;

      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];

        if (fn === pdfjs.OPS.save) {
          stack.push(matrix);
        } else if (fn === pdfjs.OPS.restore) {
          matrix = stack.pop() ?? IDENTITY;
        } else if (fn === pdfjs.OPS.transform) {
          const args = argsArray[i] as number[];

          matrix = multiply(matrix, [
            args[0],
            args[1],
            args[2],
            args[3],
            args[4],
            args[5],
          ]);
        } else if (fn === pdfjs.OPS.constructPath) {
          const pathArgs = argsArray[i] as [
            number,
            [Float32Array | null],
            Float32Array | null,
          ];

          const packedPath = pathArgs[1]?.[0];

          if (packedPath) {
            processPackedPath(
              packedPath,
              writer,
              opts.scale,
              matrix,
              tolerance,
            );
          }
        }
      }
    } catch (err) {
      warnings.push(
        `Page ${pageIndex + 1}: path extraction failed — ${String(err)}`,
      );
    }
  }

  if (opts.includeText) {
    try {
      const textContent = await page.getTextContent();

      for (const item of textContent.items) {
        if (!('str' in item) || !item.str.trim()) {
          continue;
        }

        const tx = item.transform[4];
        const ty = item.transform[5];
        const fontSize =
          Math.abs(item.transform[3]) || 12;

        writer.addText(
          pt(tx * opts.scale, ty * opts.scale),
          fontSize * opts.scale,
          item.str,
        );
      }
    } catch (err) {
      warnings.push(
        `Page ${pageIndex + 1}: text extraction failed — ${String(err)}`,
      );
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
    curveTolerance: options.curveTolerance ?? 0.25,
  };

  const warnings: string[] = [];

  const loadingTask = pdfjs.getDocument({
    data:
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data,
  });

  const pdf: PDFDocumentProxy = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const pagesToProcess =
    opts.pages.length > 0
      ? opts.pages.filter(
          (p) => p >= 1 && p <= totalPages,
        )
      : Array.from(
          { length: totalPages },
          (_, i) => i + 1,
        );

  if (pagesToProcess.length === 0) {
    warnings.push('No valid pages to process.');
  }

  const writer = new DxfWriter();

  for (const pageNum of pagesToProcess) {
    const page = await pdf.getPage(pageNum);

    await processPage(
      page,
      writer,
      pageNum - 1,
      opts,
      warnings,
    );

    page.cleanup();
  }

  return {
    dxf: writer.stringify(),
    pageCount: pagesToProcess.length,
    warnings,
  };
}
