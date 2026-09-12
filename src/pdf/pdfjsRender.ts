import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { RenderedPdfPage } from './renderPage.ts'

GlobalWorkerOptions.workerSrc = pdfjsWorker

export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((next) => resolve(next), 'image/png')
    })
    if (blob) return blob
  }
  const dataUrl = canvas.toDataURL('image/png')
  const comma = dataUrl.indexOf(',')
  const binary = atob(comma >= 0 ? dataUrl.slice(comma + 1) : '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: 'image/png' })
}

export async function pdfjsRenderPage(
  pdfBytes: ArrayBuffer,
  pageIndex: number,
): Promise<RenderedPdfPage> {
  const data = new Uint8Array(pdfBytes.slice(0))
  const loadingTask = getDocument({ data, verbosity: 0 })
  try {
    const pdf = await loadingTask.promise
    if (pageIndex < 0 || pageIndex >= pdf.numPages) {
      throw new Error(`PDF page ${pageIndex + 1} is out of range`)
    }
    const page = await pdf.getPage(pageIndex + 1)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) {
      throw new Error('Could not render PDF page')
    }
    await page.render({ canvas, canvasContext, viewport }).promise
    const pngBlob = await canvasToPngBlob(canvas)
    return {
      canvas,
      pngBlob,
      pageCount: pdf.numPages,
      width: canvas.width,
      height: canvas.height,
    }
  } finally {
    await loadingTask.destroy()
  }
}
