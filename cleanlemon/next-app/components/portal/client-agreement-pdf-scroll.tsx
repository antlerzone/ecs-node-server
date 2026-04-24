"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import { Loader2, ZoomIn, ZoomOut } from "lucide-react"
import { Button } from "@/components/ui/button"

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"

type Props = {
  /** Blob object URL (`URL.createObjectURL`) */
  fileUrl: string
}

const ZOOM_MIN = 0.6
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.1

/**
 * Full-width scrollable PDF (react-pdf) with zoom controls — no browser PDF plugin chrome.
 */
export function ClientAgreementPdfScroll({ fileUrl }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [baseWidth, setBaseWidth] = useState(360)
  const [zoom, setZoom] = useState(1)
  const [numPages, setNumPages] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const raw = Math.floor(el.clientWidth)
      setBaseWidth(Math.max(200, raw))
    }
    measure()
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener("resize", measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [fileUrl])

  const pageWidth = Math.round(baseWidth * zoom)

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n)
  }, [])

  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 10) / 10))
  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 10) / 10))
  const zoomReset = () => setZoom(1)

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-muted/20">
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-border/80 bg-background/95 px-2 py-2 backdrop-blur-sm sm:justify-between sm:px-3">
        <span className="text-xs text-muted-foreground sm:text-sm">Document preview</span>
        <div className="flex items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 px-2" onClick={zoomOut} aria-label="Zoom out">
            <ZoomOut className="h-4 w-4" />
            <span className="hidden sm:inline">Out</span>
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 min-w-[3.25rem] px-1 text-xs tabular-nums" onClick={zoomReset}>
            {Math.round(zoom * 100)}%
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 px-2" onClick={zoomIn} aria-label="Zoom in">
            <ZoomIn className="h-4 w-4" />
            <span className="hidden sm:inline">In</span>
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-auto px-0 py-1"
      >
        <Document
          key={fileUrl}
          file={fileUrl}
          loading={
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
              <span className="text-sm">Loading agreement…</span>
            </div>
          }
          error={
            <p className="px-4 py-12 text-center text-sm text-destructive">
              Could not show this PDF here. Close and try again, or contact your operator for a copy.
            </p>
          }
          onLoadSuccess={onLoadSuccess}
          className="flex w-full min-w-0 flex-col items-center gap-2 pb-6 pt-1"
        >
          {numPages > 0
            ? Array.from({ length: numPages }, (_, i) => (
                <Page
                  key={`${fileUrl}-p-${i + 1}`}
                  pageNumber={i + 1}
                  width={pageWidth}
                  className="max-w-none shrink-0 overflow-hidden bg-white shadow-sm"
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />
              ))
            : null}
        </Document>
      </div>
    </div>
  )
}
