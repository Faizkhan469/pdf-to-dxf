    }
  }

  processConstructPath(subOps, coords, writer, scale);
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

      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];

        // pdfjs v4: all path sub-ops are batched into constructPath
        if (fn === pdfjs.OPS.constructPath) {
         const pathArgs = argsArray[i] as [
  number,
  [Float32Array | null],
  Float32Array | null,
];

const packedPath = pathArgs[1]?.[0];

if (packedPath) {
  processPackedPath(packedPath, writer, opts.scale);
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
        const pos = pt(tx * opts.scale, ty * opts.scale);
        writer.addText(pos, fontSize * opts.scale, item.str);
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
