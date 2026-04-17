"use client"

import { useRef, useImperativeHandle, forwardRef, useCallback } from "react"
import SignatureCanvas from "react-signature-canvas"
import { Button } from "@/components/ui/button"

const PAD_WIDTH = 400
const PAD_HEIGHT = 180

export interface SignaturePadHandle {
  getDataURL: () => string
  isEmpty: () => boolean
  clear: () => void
}

export const SignaturePad = forwardRef<SignaturePadHandle, { onClear?: () => void }>(
  function SignaturePad({ onClear }, ref) {
    const padRef = useRef<SignatureCanvas>(null)

    useImperativeHandle(
      ref,
      () => ({
        getDataURL() {
          return padRef.current?.toDataURL("image/png") ?? ""
        },
        isEmpty() {
          return padRef.current?.isEmpty() ?? true
        },
        clear() {
          padRef.current?.clear()
          onClear?.()
        },
      }),
      [onClear]
    )

    const handleClear = useCallback(() => {
      padRef.current?.clear()
      onClear?.()
    }, [onClear])

    return (
      <div className="space-y-2">
        <div
          className="rounded-lg border border-border bg-white overflow-hidden"
          style={{ width: PAD_WIDTH, maxWidth: "100%" }}
        >
          <SignatureCanvas
            ref={padRef}
            canvasProps={{
              width: PAD_WIDTH,
              height: PAD_HEIGHT,
              className: "w-full h-full touch-none",
              style: { display: "block" },
            }}
            penColor="#0f172a"
            minWidth={1}
            maxWidth={2}
            backgroundColor="rgb(255, 255, 255)"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handleClear}>
          Clear signature
        </Button>
      </div>
    )
  }
)
