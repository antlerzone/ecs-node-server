"use client"

import { useFrame, useThree } from "@react-three/fiber"
import { Float, SoftShadows } from "@react-three/drei"
import { useMemo, useRef } from "react"
import * as THREE from "three"
import { useHomedemoVisual } from "./homedemo-visual-context"
import { HOMEDEMO_SCROLL_SECTIONS } from "@/lib/homedemo-data"

/** intro + 8 scroll sections */
const VISUAL_COUNT = 9

function lerpVec(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) {
  out.lerpVectors(a, b, Math.min(1, t))
  return out
}

export function HomedemoSceneInner() {
  const { activeVisualIndex, reducedMotion, scrollProgress01 } = useHomedemoVisual()
  const { camera } = useThree()
  const tmp = useRef(new THREE.Vector3())
  const look = useRef(new THREE.Vector3(0, 0.35, 0))

  const cameraStates = useMemo(() => {
    const states: { pos: THREE.Vector3; look: THREE.Vector3 }[] = [
      { pos: new THREE.Vector3(9, 5.5, 11), look: new THREE.Vector3(0, 0.45, 0) },
      { pos: new THREE.Vector3(5.2, 2.1, 7.2), look: new THREE.Vector3(0.3, 1.15, 0.2) },
      { pos: new THREE.Vector3(2.1, 1.45, 4.8), look: new THREE.Vector3(0.25, 1.25, 1.8) },
      { pos: new THREE.Vector3(-4.2, 2.4, 5.5), look: new THREE.Vector3(-1.2, 1.1, 0.5) },
      { pos: new THREE.Vector3(-2.4, 1.4, 3.2), look: new THREE.Vector3(-1.6, 1.28, 1.4) },
      { pos: new THREE.Vector3(17.8, 2.8, 5.5), look: new THREE.Vector3(19.2, 1.45, 4.2) },
      { pos: new THREE.Vector3(18.5, 2.0, 6.8), look: new THREE.Vector3(20.5, 1.35, 5.0) },
      { pos: new THREE.Vector3(-3.5, 2.3, -2.8), look: new THREE.Vector3(-0.8, 0.85, 0.6) },
      { pos: new THREE.Vector3(7.5, 6.2, 12), look: new THREE.Vector3(0, 0.5, 0) },
    ]
    return states
  }, [])

  const sectionColors = useMemo(
    () => ["#c4b5fd", "#c4b5fd", "#7dd3fc", "#7dd3fc", "#fdba74", "#fdba74", "#fb7185", "#d6d3d1"],
    []
  )

  useFrame((_, delta) => {
    if (reducedMotion) {
      camera.position.copy(cameraStates[0].pos)
      camera.lookAt(look.current)
      return
    }
    const idx = Math.max(0, Math.min(VISUAL_COUNT - 1, activeVisualIndex))
    const next = cameraStates[idx]
    const speed = 1 - Math.pow(0.001, delta)
    lerpVec(camera.position, next.pos, speed * 0.075, tmp.current)
    camera.position.copy(tmp.current)
    look.current.lerp(next.look, speed * 0.055)
    camera.lookAt(look.current)
  })

  const hueIndex = Math.max(0, Math.min(HOMEDEMO_SCROLL_SECTIONS.length - 1, activeVisualIndex - 1))
  const floorTint =
    activeVisualIndex === 0 ? "#ede4e8" : HOMEDEMO_SCROLL_SECTIONS[hueIndex]?.sceneHue ?? "#e8d5dc"

  const boxHue = sectionColors[Math.max(0, Math.min(sectionColors.length - 1, hueIndex))] ?? "#e8d5dc"
  const showApartment = activeVisualIndex !== 5 && activeVisualIndex !== 6
  const rotY = reducedMotion ? 0 : scrollProgress01 * 0.22

  return (
    <>
      <color attach="background" args={[activeVisualIndex === 5 || activeVisualIndex === 6 ? "#1c1917" : "#f5eef2"]} />
      <fog attach="fog" args={[(activeVisualIndex === 5 || activeVisualIndex === 6 ? "#1c1917" : "#f5eef2"), 12, 42]} />
      <ambientLight intensity={0.52} />
      <directionalLight
        castShadow
        position={[8, 14, 6]}
        intensity={activeVisualIndex === 5 || activeVisualIndex === 6 ? 0.35 : 1.05}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      {activeVisualIndex === 5 || activeVisualIndex === 6 ? (
        <pointLight position={[19, 3.5, 5]} intensity={0.9} distance={12} decay={2} />
      ) : null}
      <SoftShadows size={24} samples={8} focus={0.5} />

      <group position={[0, -0.6, 0]} rotation-y={rotY}>
        {showApartment && (
          <>
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[80, 80]} />
              <meshStandardMaterial color={floorTint} roughness={0.85} metalness={0.05} />
            </mesh>
            <Float speed={reducedMotion ? 0 : 1.0} rotationIntensity={0.12} floatIntensity={0.28}>
              <mesh position={[0, 1.1, 0]} castShadow receiveShadow>
                <boxGeometry args={[2.4, 1.8, 2.4]} />
                <meshStandardMaterial color={boxHue} roughness={0.45} metalness={0.1} />
              </mesh>
            </Float>
            {/* Tenant figure + phone */}
            <group position={[1.2, 0.35, 1.5]}>
              <mesh position={[0, 0.55, 0]} castShadow>
                <capsuleGeometry args={[0.22, 0.65, 6, 12]} />
                <meshStandardMaterial color="#7c3aed" roughness={0.55} />
              </mesh>
              <mesh position={[0.15, 0.75, 0.35]} rotation-x={-0.4} castShadow>
                <boxGeometry args={[0.12, 0.22, 0.04]} />
                <meshStandardMaterial color="#1e1b4b" roughness={0.3} metalness={0.4} />
              </mesh>
            </group>
            {/* Owner lounge + speaker */}
            <group position={[-2.8, 0, 1]}>
              <mesh position={[0, 0.4, 0]} castShadow>
                <capsuleGeometry args={[0.24, 0.6, 6, 12]} />
                <meshStandardMaterial color="#0369a1" roughness={0.55} />
              </mesh>
              <mesh position={[-0.9, 0.35, 0.2]} castShadow>
                <boxGeometry args={[0.35, 0.5, 0.25]} />
                <meshStandardMaterial color="#64748b" roughness={0.45} />
              </mesh>
            </group>
            {/* Sofa / pain area */}
            <mesh position={[-1.2, 0.35, -2.2]} castShadow receiveShadow>
              <boxGeometry args={[1.8, 0.45, 0.9]} />
              <meshStandardMaterial color="#fda4af" roughness={0.6} />
            </mesh>
            <mesh position={[-2.8, 0.45, 1.2]} castShadow>
              <boxGeometry args={[0.9, 0.9, 0.9]} />
              <meshStandardMaterial color="#e2e8f0" roughness={0.5} />
            </mesh>
            <mesh position={[2.4, 0.35, -0.8]} castShadow>
              <cylinderGeometry args={[0.35, 0.45, 0.7, 16]} />
              <meshStandardMaterial color="#fecdd3" roughness={0.4} />
            </mesh>
          </>
        )}

        {/* Office: boss + coffee + desk */}
        <group position={[18, 0, 4.5]} visible={activeVisualIndex === 5 || activeVisualIndex === 6}>
          <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
            <planeGeometry args={[8, 8]} />
            <meshStandardMaterial color="#292524" roughness={0.9} metalness={0.02} />
          </mesh>
          <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.8, 0.08, 1.4]} />
            <meshStandardMaterial color="#44403c" roughness={0.4} metalness={0.15} />
          </mesh>
          <mesh position={[-0.4, 0.95, 0.2]} castShadow>
            <capsuleGeometry args={[0.26, 0.7, 6, 12]} />
            <meshStandardMaterial color="#57534e" roughness={0.55} />
          </mesh>
          <mesh position={[0.35, 0.88, 0.45]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, 0.12, 12]} />
            <meshStandardMaterial color="#78350f" roughness={0.35} />
          </mesh>
          {activeVisualIndex === 6 && (
            <mesh position={[0.2, 1.05, 0.15]} castShadow>
              <boxGeometry args={[0.9, 0.02, 0.55]} />
              <meshStandardMaterial color="#0ea5e9" emissive="#0369a1" emissiveIntensity={0.35} />
            </mesh>
          )}
        </group>
      </group>
    </>
  )
}
