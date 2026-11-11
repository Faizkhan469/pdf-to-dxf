/**
 * pdf-to-dxf — Core conversion engine
 * Part of the ek-mc civil toolset
 *
 * Strategy:
 *  1. Parse each PDF page with pdfjs-dist to extract vector paths and text.
 *  2. Translate each element into DXF entities using @tarikjabiri/dxf DxfWriter.
 *  3. Return the DXF string (or write to file in CLI mode).
 *
 * Notes on pdfjs v4:
 *  pdfjs v4 batches all path sub-operations (moveTo, lineTo, curveTo, rectangle,
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
}

export interface ConvertResult {
  dxf: string;
  pageCount: number;
  warnings: string[];
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Vec3 = { x: number; y: number; z: number };

function pt(x: number, y: number): Vec3 {
  return point3d(x, y, 0);
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
