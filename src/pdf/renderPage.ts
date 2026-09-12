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

async function pdfjsRenderPage(pdfBytes: ArrayBuffer, pageIndex: number): Promise<RenderedPdfPage> {
  const { pdfjsRenderPage: render } = await import('./pdfjsRender.ts')
  return render(pdfBytes, pageIndex)
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
