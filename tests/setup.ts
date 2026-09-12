const objectUrls = new Map<string, Blob>()
let next = 0

function createObjectURL(obj: Blob | MediaSource): string {
  const url = `blob:vitest:${++next}`
  if (typeof Blob !== 'undefined' && obj instanceof Blob) objectUrls.set(url, obj)
  return url
}

function revokeObjectURL(url: string): void {
  objectUrls.delete(url)
}

URL.createObjectURL = createObjectURL
URL.revokeObjectURL = revokeObjectURL

if (typeof window !== 'undefined') {
  window.URL.createObjectURL = createObjectURL
  window.URL.revokeObjectURL = revokeObjectURL
}
