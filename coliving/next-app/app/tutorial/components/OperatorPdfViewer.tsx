"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"

type Props = { file: string }

export function OperatorPdfViewer({ file }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [numPages, setNumPages] = useState(0)

  const pdfUrl = `/api/tutorial-operator-pdf?file=${encodeURIComponent(file)}`

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setWidth(Math.max(280, Math.floor(el.clientWidth - 16)))
    })
    ro.observe(el)
    setWidth(Math.max(280, Math.floor(el.clientWidth - 16)))
    return () => ro.disconnect()
  }, [])

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n)
  }, [])

  return (
    <div
      ref={containerRef}
      className="w-full overflow-auto bg-muted/30 rounded-b-lg p-2 min-h-[70vh] max-h-[75vh]"
    >
      <Document
        key={file}
        file={pdfUrl}
        loading={<p className="text-sm text-muted-foreground py-8 text-center">Loading PDF…</p>}
        error={
          <p className="text-sm text-destructive py-8 text-center px-4">
            Could not load this PDF. Use &quot;Open in new tab&quot; below.
          </p>
        }
        onLoadSuccess={onLoadSuccess}
        className="flex flex-col items-center"
      >
        {numPages > 0
          ? Array.from({ length: numPages }, (_, i) => (
              <Page
                key={`${file}-p-${i + 1}`}
                pageNumber={i + 1}
                width={width}
                className="mb-3 shadow-sm bg-background max-w-full"
                renderTextLayer
                renderAnnotationLayer
              />
            ))
          : null}
      </Document>
    </div>
  )
}
