"use client"

import { useState, useCallback } from "react"
import { X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"

type Role = "owner" | "tenant" | "operator"

const IMG_BASE: Record<Role, string> = {
  owner: "/tutorial/owner",
  tenant: "/tutorial/tenant",
  operator: "/tutorial/operator",
}

const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 2.5, 3] as const
const MIN_ZOOM = 0.5 // 50% shrink
const MAX_ZOOM = 3 // 300% magnifying

export function TutorialStep({
  role,
  num,
  title,
  doText,
  seeText,
  img,
  imgAlt,
  caption,
  tip,
}: {
  role: Role
  num: string
  title: string
  doText: React.ReactNode
  seeText: React.ReactNode
  img?: string
  imgAlt?: string
  caption?: string
  tip?: string
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const base = IMG_BASE[role]
  const imgSrc = img ? `${base}/${img}` : undefined

  const handleImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    (e.target as HTMLImageElement).style.display = "none"
    const next = (e.target as HTMLImageElement).nextElementSibling
    if (next) (next as HTMLElement).style.display = "block"
    setImgLoaded(false)
  }

  const onLightboxOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setZoom(1)
      setImgSize(null)
    }
    setLightboxOpen(open)
  }, [])

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, ZOOM_STEPS.find((s) => s > z) ?? z + 0.5))
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, [...ZOOM_STEPS].reverse().find((s) => s < z) ?? z - 0.5))
  const zoomReset = () => setZoom(1)
  const zoomMin = () => setZoom(MIN_ZOOM) // 50%
  const zoomMax = () => setZoom(MAX_ZOOM) // 300%

  const onLightboxImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.target as HTMLImageElement
    if (el.naturalWidth && el.naturalHeight) setImgSize({ w: el.naturalWidth, h: el.naturalHeight })
  }

  return (
    <section className="mb-10">
      <h3 className="text-lg font-bold text-foreground mb-2">
        Step {num} — {title}
      </h3>
      <p className="text-sm font-semibold text-foreground/90 mb-1">What you do:</p>
      <p className="text-sm text-muted-foreground mb-3">{doText}</p>
      <p className="text-sm font-semibold text-foreground/90 mb-1">What you see:</p>
      <p className="text-sm text-muted-foreground mb-3">{seeText}</p>
      {imgSrc && (
        <div className="w-full rounded-lg border border-border overflow-hidden bg-muted/30 my-4">
          <button
            type="button"
            onClick={() => imgLoaded && setLightboxOpen(true)}
            className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-lg"
            aria-label="Enlarge image"
          >
            <img
              src={imgSrc}
              alt={imgAlt || title}
              className={`w-full h-auto object-contain min-h-[280px] ${imgLoaded ? "cursor-zoom-in" : ""}`}
              onError={handleImgError}
            />
          </button>
          <div className="p-4 text-center text-sm text-muted-foreground border-t border-border" style={{ display: "none" }} data-placeholder>
            [Screenshot: {img}]
          </div>
          {imgLoaded && (
            <p className="text-xs text-muted-foreground text-center py-1.5">Click image to enlarge · Use +/− in lightbox to zoom</p>
          )}
        </div>
      )}

      <Dialog open={lightboxOpen} onOpenChange={onLightboxOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="!w-[99vw] !max-w-[99vw] w-[99vw] max-w-[99vw] sm:!max-w-[99vw] h-[97vh] max-h-[97vh] p-2 pt-12 bg-black/95 border-border flex flex-col"
          style={{ width: "99vw", maxWidth: "99vw", height: "97vh", maxHeight: "97vh" }}
        >
          <DialogTitle className="sr-only">{imgAlt || title}</DialogTitle>
          <button
            type="button"
            onClick={() => onLightboxOpenChange(false)}
            className="absolute right-2 top-2 z-10 rounded-full p-1.5 bg-white/10 text-white hover:bg-white/20 transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>

          {/* Zoom toolbar: 50% / − / + / 100% / 300% / current % */}
          <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-lg bg-white/10 p-1.5 text-white">
            <button
              type="button"
              onClick={zoomMin}
              className="rounded px-2 py-1 text-xs font-medium hover:bg-white/20"
              aria-label="Shrink to 50%"
              title="50%"
            >
              50%
            </button>
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              className="rounded p-1.5 hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none"
              aria-label="Zoom out"
            >
              <ZoomOut size={18} />
            </button>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              className="rounded p-1.5 hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none"
              aria-label="Zoom in"
            >
              <ZoomIn size={18} />
            </button>
            <span className="text-xs text-white/90 px-1 min-w-[2.5rem] text-center" aria-live="polite">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={zoomReset}
              className="rounded px-2 py-1 text-xs font-medium hover:bg-white/20"
              aria-label="Reset to 100%"
            >
              <RotateCcw size={14} className="inline mr-0.5" />
              100%
            </button>
            <button
              type="button"
              onClick={zoomMax}
              className="rounded px-2 py-1 text-xs font-semibold bg-white/20 hover:bg-white/30"
              aria-label="Magnify to 300%"
              title="300%"
            >
              300%
            </button>
          </div>

          {/* Image: at 100% fit to lightbox (no scroll); at other zoom use scale + scroll */}
          <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center min-w-0">
            {imgSrc && (
              zoom === 1 && imgSize ? (
                <img
                  src={imgSrc}
                  alt={imgAlt || title}
                  className="block max-w-full max-h-full w-auto h-auto object-contain transition-transform duration-150"
                  style={{ maxHeight: "calc(97vh - 4rem)" }}
                  onClick={(e) => e.stopPropagation()}
                  onLoad={onLightboxImgLoad}
                />
              ) : (
                <div
                  className="inline-block"
                  style={
                    imgSize
                      ? {
                          width: imgSize.w * zoom,
                          height: imgSize.h * zoom,
                          maxWidth: imgSize.w * zoom,
                          maxHeight: imgSize.h * zoom,
                        }
                      : undefined
                  }
                >
                  <img
                    src={imgSrc}
                    alt={imgAlt || title}
                    className="block transition-transform duration-150"
                    style={{
                      transform: imgSize ? `scale(${zoom})` : undefined,
                      transformOrigin: "0 0",
                      width: imgSize ? imgSize.w : undefined,
                      height: imgSize ? imgSize.h : undefined,
                      maxWidth: imgSize ? "none" : "100%",
                      maxHeight: imgSize ? "none" : "85vh",
                      objectFit: "contain",
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onLoad={onLightboxImgLoad}
                  />
                </div>
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
      {caption && <p className="text-xs text-muted-foreground italic">{caption}</p>}
      {tip && (
        <p className="text-sm text-foreground/80 mt-2 rounded-md bg-muted/50 px-3 py-2">
          <span className="font-semibold">Tip:</span> {tip}
        </p>
      )}
    </section>
  )
}
