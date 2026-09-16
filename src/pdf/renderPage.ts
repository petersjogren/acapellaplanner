export type RenderedPdfPage = {
  canvas: HTMLCanvasElement
  pngBlob: Blob
  pageCount: number
  width: number
  height: number
}

export type RenderPageToCanvas = (
  pdfBytes: ArrayBuffer,
  pageIndex: number,
) => Promise<RenderedPdfPage>

/** Map a missing hashed pdfjs chunk (stale PWA after a Pages deploy) to singer copy. */
export function pdfEngineLoadError(err: unknown): unknown {
  if (err instanceof Error && /dynamically imported module/i.test(err.message)) {
    return new Error('Could not load the PDF reader. Refresh the page and try again.')
  }
  return err
}

async function pdfjsRenderPage(pdfBytes: ArrayBuffer, pageIndex: number): Promise<RenderedPdfPage> {
  try {
    const { pdfjsRenderPage: render } = await import('./pdfjsRender.ts')
    return render(pdfBytes, pageIndex)
  } catch (err) {
    throw pdfEngineLoadError(err)
  }
}

let renderImpl: RenderPageToCanvas = pdfjsRenderPage

export function setRenderPageToCanvas(fn: RenderPageToCanvas | null): void {
  renderImpl = fn ?? pdfjsRenderPage
}

export function renderPageToCanvas(
  pdfBytes: ArrayBuffer,
  pageIndex: number,
): Promise<RenderedPdfPage> {
  return renderImpl(pdfBytes, pageIndex)
}
