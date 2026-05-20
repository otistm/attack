/**
 * Pack3D — interactive pack-opening sequence used at the start of an SZN
 * run. Two distinct phases:
 *
 *   PACK     — A 3D pack mesh floats in front of the camera. The user
 *              clicks it to rip it open.
 *   OPENING  — The pack shakes, scales up, and fades out. A particle
 *              sparkle field comes to life behind it. When the fade
 *              completes, we transition to:
 *   REVEALED — The 3D canvas fades out and a 2D grid of `PlayerCard`
 *              components fades in -- face-up, all 10 cards, identical
 *              to the design used everywhere else (field, roster
 *              drawer, merchant listings). No flip-to-inspect: the
 *              user already knows what they got. A "Head to the Front
 *              Office" CTA advances out of the screen.
 *
 * The Three.js context is tied to a React-managed mount node and torn
 * down on unmount. React only owns the surrounding chrome (instruction
 * copy, "tap to rip" fallback, the 2D reveal grid, the continue CTA)
 * so the heavy 3D loop never triggers unnecessary re-renders.
 *
 * Once the reveal lands the 3D canvas keeps rendering an empty scene
 * underneath the grid for a single frame's worth of crossfade, then
 * we let the user advance. We don't dispose mid-flight because the
 * unmount cleanup already handles GPU resource teardown.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import * as THREE from "three";
import type { RosterPlayer } from "../lib/run";
import { PlayerCard } from "./PlayerCard";

interface Pack3DProps {
  roster: RosterPlayer[];
  onComplete: () => void;
  /**
   * Fired whenever the internal pack state changes (PACK → OPENING →
   * REVEALED). Lets the parent (e.g. `PackRipScreen`) hang controller
   * bindings off the current phase without reaching into the
   * SceneManager.
   */
  onStateChange?: (state: PackState) => void;
  /**
   * Optional ref-callback bound to an imperative "rip" trigger. The
   * parent stores the callback and invokes it on CROSS so the pack
   * advances from PACK → OPENING even when the user can't reach the
   * canvas with a pointer (controller-only flow). Calling after the
   * pack is already opening / revealed is a no-op.
   */
  onRequestRip?: (rip: () => void) => void;
}

type PackState = "PACK" | "OPENING" | "REVEALED";

// HTML helper used by the pack texture — pixel-aligned rounded rect
// drawing so the wordmark stays crisp under DPR scaling.
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function createPackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 712;
  const ctx = canvas.getContext("2d")!;

  // Foil gradient body.
  const grd = ctx.createLinearGradient(0, 0, 512, 712);
  grd.addColorStop(0, "#fde68a");
  grd.addColorStop(0.5, "#f59e0b");
  grd.addColorStop(1, "#7c2d12");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 512, 712);

  // Sheen
  const sheen = ctx.createLinearGradient(0, 0, 512, 712);
  sheen.addColorStop(0, "rgba(255,255,255,0.4)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(0,0,0,0.3)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, 512, 712);

  // Diagonal banner with the wordmark.
  ctx.save();
  ctx.translate(256, 356);
  ctx.rotate(-0.15);
  ctx.fillStyle = "#7c2d12";
  ctx.font = "900 88px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(255,255,255,0.7)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.fillText("DUGOUT", 0, -90);
  ctx.fillText("STARTER", 0, 0);
  ctx.restore();

  // Subtle foil border so the pack reads as wrapped, not flat.
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 6;
  roundRect(ctx, 12, 12, 488, 688, 18);
  ctx.stroke();

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 32px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("10 CARDS PER PACK", 256, 520);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

class SceneManager {
  // Three.js core
  container: HTMLDivElement;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  raycaster = new THREE.Raycaster();
  // Initialize the mouse OFF-SCREEN so the very first raycast (which
  // happens on the first animate tick before any pointermove event)
  // doesn't accidentally hit the pack. (0, 0) in NDC sits dead-center
  // of the viewport -- exactly where the pack lives -- so without
  // this offset the pack appears "pre-hovered" and the very first
  // synthetic pointerdown anywhere on the canvas would auto-rip it.
  mouse = new THREE.Vector2(-10, -10);
  clock = new THREE.Clock();

  // Scene objects
  ground: THREE.Mesh;
  sparkles: THREE.Points;
  packMesh: THREE.Mesh | null = null;
  packTex: THREE.CanvasTexture | null = null;

  // Per-frame scratch instances. Hoisted out of animate() so we don't
  // allocate/throw away Three.js objects every frame while the pack
  // floats and shakes.
  private _tHoverScale = new THREE.Vector3();
  private _tOpenScale = new THREE.Vector3(1.25, 1.25, 1.25);

  // State
  state: PackState = "PACK";
  hoveredObject: THREE.Object3D | null = null;
  setReactState: (s: PackState) => void;

  // Bound listeners. `!` keeps `strictPropertyInitialization` happy.
  boundResize!: () => void;
  boundPointerMove!: (e: PointerEvent) => void;
  boundPointerDown!: () => void;
  boundPointerLeave!: () => void;
  boundAnimate!: () => void;

  constructor(
    container: HTMLDivElement,
    setReactState: (s: PackState) => void,
  ) {
    this.container = container;
    this.setReactState = setReactState;

    this.scene.background = new THREE.Color("#0f172a");

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      100,
    );
    this.camera.position.z = 11;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Defensive WebGL context-loss handler. Without preventDefault, a
    // browser-initiated context loss (e.g. another canvas grabbing the
    // hardware) becomes permanent and the user sees a black screen
    // even after the pack rips. preventDefault hands restoration back
    // to us; the animation loop keeps spinning safely without throwing.
    this.renderer.domElement.addEventListener(
      "webglcontextlost",
      (event) => {
        event.preventDefault();
      },
      false,
    );

    // Lighting -- ambient + directional + colored accent rims so the
    // foil pack catches a few warm/cool highlights as it floats.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
    dirLight.position.set(0, 5, 5);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    const pl1 = new THREE.PointLight(0x60a5fa, 2, 20);
    pl1.position.set(-5, 5, 2);
    this.scene.add(pl1);
    const pl2 = new THREE.PointLight(0xf472b6, 2, 20);
    pl2.position.set(5, -5, 2);
    this.scene.add(pl2);
    const pl3 = new THREE.PointLight(0xeab308, 1.5, 20);
    pl3.position.set(0, -5, 5);
    this.scene.add(pl3);

    // Floor for contact shadows.
    const planeGeo = new THREE.PlaneGeometry(60, 60);
    const planeMat = new THREE.MeshStandardMaterial({
      color: "#0f172a",
      roughness: 1,
      metalness: 0,
    });
    this.ground = new THREE.Mesh(planeGeo, planeMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -3.8;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // Sparkle particles bloom in during OPENING / REVEALED so the rip
    // moment has visual punch without overdriving the calm PACK state.
    this.sparkles = this.createSparkles();
    this.scene.add(this.sparkles);

    this.buildPack();

    // Bind & attach listeners.
    this.boundResize = this.onResize.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerLeave = () => {
      // Park the mouse off-screen rather than at (0,0) so the next
      // raycast doesn't auto-hover the pack (which sits at world
      // origin and projects to ~NDC (0,0) at our camera distance).
      this.mouse.set(-10, -10);
      this.hoveredObject = null;
    };
    this.boundAnimate = this.animate.bind(this);

    window.addEventListener("resize", this.boundResize);
    this.renderer.domElement.addEventListener(
      "pointermove",
      this.boundPointerMove,
    );
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.boundPointerDown,
    );
    this.renderer.domElement.addEventListener(
      "pointerleave",
      this.boundPointerLeave,
    );

    this.renderer.setAnimationLoop(this.boundAnimate);
  }

  createSparkles(): THREE.Points {
    const geo = new THREE.BufferGeometry();
    const count = 140;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      positions[i] = (Math.random() - 0.5) * 14;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xfcd34d,
      size: 0.18,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geo, mat);
  }

  buildPack() {
    const packGeo = new THREE.BoxGeometry(2.8, 3.8, 0.22);
    this.packTex = createPackTexture();
    const packFrontMat = new THREE.MeshStandardMaterial({
      map: this.packTex,
      metalness: 0.85,
      roughness: 0.18,
      transparent: true,
    });
    const packEdgeMat = new THREE.MeshStandardMaterial({
      color: "#7c2d12",
      metalness: 0.7,
      roughness: 0.3,
      transparent: true,
    });

    // BoxGeometry face order: 0:R, 1:L, 2:T, 3:B, 4:Front (Z+), 5:Back (Z-).
    this.packMesh = new THREE.Mesh(packGeo, [
      packEdgeMat,
      packEdgeMat,
      packEdgeMat,
      packEdgeMat,
      packFrontMat,
      packFrontMat,
    ]);
    this.packMesh.castShadow = true;
    this.packMesh.userData = { type: "pack" };
    this.scene.add(this.packMesh);
  }

  animate() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();

    // Hover raycast (only matters while the pack is still up).
    if (this.state === "PACK") {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const targets: THREE.Object3D[] = this.packMesh ? [this.packMesh] : [];
      const intersects = this.raycaster.intersectObjects(targets);
      this.hoveredObject = intersects.length > 0 ? intersects[0].object : null;
      this.renderer.domElement.style.cursor = this.hoveredObject
        ? "pointer"
        : "default";
    } else {
      this.hoveredObject = null;
      this.renderer.domElement.style.cursor = "default";
    }

    // Particles bloom in once the user starts the rip and stay lit
    // through the reveal.
    const sparkleMat = this.sparkles.material as THREE.PointsMaterial;
    if (this.state === "OPENING" || this.state === "REVEALED") {
      sparkleMat.opacity = THREE.MathUtils.lerp(sparkleMat.opacity, 0.5, dt * 2);
      this.sparkles.rotation.y += dt * 0.1;
      const positions = (
        this.sparkles.geometry.attributes.position as THREE.BufferAttribute
      ).array as Float32Array;
      for (let i = 1; i < positions.length; i += 3) {
        positions[i] += dt * 0.35;
        if (positions[i] > 7) positions[i] = -7;
      }
      this.sparkles.geometry.attributes.position.needsUpdate = true;
    } else {
      sparkleMat.opacity = 0;
    }

    if (this.state === "PACK") {
      // Floating + hover scale on the pack.
      if (this.packMesh) {
        const floatY = Math.sin(elapsed * 2) * 0.08;
        this.packMesh.position.y = THREE.MathUtils.lerp(
          this.packMesh.position.y,
          floatY,
          dt * 5,
        );
        const targetScale = this.hoveredObject === this.packMesh ? 1.05 : 1;
        this._tHoverScale.set(targetScale, targetScale, targetScale);
        this.packMesh.scale.lerp(this._tHoverScale, dt * 5);
      }
    } else if (this.state === "OPENING" && this.packMesh) {
      // Pack drifts up, jitters left/right, and fades to invisible.
      this.packMesh.position.y = THREE.MathUtils.lerp(
        this.packMesh.position.y,
        1,
        dt * 5,
      );
      this.packMesh.position.x = Math.sin(elapsed * 50) * 0.1;
      this.packMesh.scale.lerp(this._tOpenScale, dt * 10);
      // Pack uses two distinct material refs (front + edge) but the
      // edge ref is reused across all four side faces. De-dupe via a
      // Set so the opacity tween runs once per material per frame
      // instead of four times on packEdgeMat.
      const mats = this.packMesh.material as THREE.MeshStandardMaterial[];
      const uniqueMats = new Set(mats);
      uniqueMats.forEach((m) => {
        m.opacity = THREE.MathUtils.lerp(m.opacity, 0, dt * 4);
      });
      if (mats[0].opacity < 0.08) {
        this.packMesh.visible = false;
        this.setState("REVEALED");
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  onPointerMove(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  onPointerDown() {
    if (this.state !== "PACK") return;
    if (!this.hoveredObject) return;
    if ((this.hoveredObject.userData as { type?: string }).type === "pack") {
      this.setState("OPENING");
    }
  }

  onResize() {
    if (!this.container) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(
      this.container.clientWidth,
      this.container.clientHeight,
    );
  }

  setState(newState: PackState) {
    this.state = newState;
    this.setReactState(newState);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.boundResize);
    this.renderer.domElement.removeEventListener(
      "pointermove",
      this.boundPointerMove,
    );
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.boundPointerDown,
    );
    this.renderer.domElement.removeEventListener(
      "pointerleave",
      this.boundPointerLeave,
    );

    if (this.packMesh) {
      this.scene.remove(this.packMesh);
      this.packMesh.geometry.dispose();
      (this.packMesh.material as THREE.MeshStandardMaterial[]).forEach((m) =>
        m.dispose(),
      );
    }
    this.packTex?.dispose();

    this.ground.geometry.dispose();
    (this.ground.material as THREE.MeshStandardMaterial).dispose();
    this.sparkles.geometry.dispose();
    (this.sparkles.material as THREE.PointsMaterial).dispose();
    // Reset cursor BEFORE disposal; once the WebGL context is gone we
    // can't render anything, but the cursor style is plain CSS so it
    // stays applied. Reset prevents leaving the OS cursor in
    // "pointer" mode after the pack-rip screen unmounts.
    this.renderer.domElement.style.cursor = "default";
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(
        this.renderer.domElement,
      );
    }
  }
}

export function Pack3D({
  roster,
  onComplete,
  onStateChange,
  onRequestRip,
}: Pack3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const managerRef = useRef<SceneManager | null>(null);
  const [packState, setPackState] = useState<PackState>("PACK");

  // Bridge state changes up to the parent so external surfaces (the
  // controller binding inside `PackRipScreen`) can render the right
  // CTA semantics. Effect — not inline call — to avoid setState
  // during render.
  useEffect(() => {
    onStateChange?.(packState);
  }, [packState, onStateChange]);

  // Hand the parent an imperative "rip" trigger that mirrors the
  // tap-to-rip fallback button. Stable identity (no deps) so the
  // parent can register once and forget.
  useEffect(() => {
    if (!onRequestRip) return;
    const rip = () => {
      const m = managerRef.current;
      if (m) m.setState("OPENING");
      else setPackState("REVEALED");
    };
    onRequestRip(rip);
  }, [onRequestRip]);

  useEffect(() => {
    if (!mountRef.current) return;
    // Defer SceneManager creation to the next frame so React 19
    // StrictMode's transient mount → unmount → mount cycle doesn't
    // momentarily allocate two WebGL contexts. The browser caps live
    // contexts and a same-frame double-allocation has been observed
    // to drop the SECOND context with a "Context Lost" warning,
    // leaving the user staring at a black canvas.
    let manager: SceneManager | null = null;
    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled || !mountRef.current) return;
      manager = new SceneManager(mountRef.current, setPackState);
      managerRef.current = manager;
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (manager) {
        manager.dispose();
        managerRef.current = null;
      }
    };
    // We deliberately exclude `onComplete` so the manager isn't torn
    // down/rebuilt on every parent render. The manager doesn't need
    // the roster anymore -- the 2D reveal grid below renders the
    // PlayerCard list directly from React props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revealed = packState === "REVEALED";

  return (
    <div className="absolute inset-0 select-none overflow-hidden">
      {/* 3D mount. Fades out as the 2D reveal fades in so the rip
          moment hands off cleanly into the grid. */}
      <motion.div
        ref={mountRef}
        className="absolute inset-0"
        style={{ touchAction: "none" }}
        animate={{ opacity: revealed ? 0 : 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      />

      {/* Top-of-screen header copy. Stays mounted through every state
          so the framing reads as a single moment, not three screens.
          Subtitles intentionally omitted -- the pack and the reveal
          grid are visually self-explanatory and the subtitles were
          competing with the title for the user's eye. */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 z-10 flex flex-col items-center pt-8 px-4">
        <h1
          className="dugout-font-sport text-4xl sm:text-5xl tracking-widest text-white uppercase"
          style={{ textShadow: "0 4px 12px rgba(0,0,0,0.6)" }}
        >
          Meet Your Squad
        </h1>
      </div>

      {/* 2D reveal grid. Mounts as soon as the user is REVEALED; fades
          in over the dissolving 3D scene. Uses the same `PlayerCard`
          component the field, roster, and merchant listings use, so
          identity carries 1:1 from pack → run. */}
      <AnimatePresence>
        {revealed && (
          <motion.div
            key="reveal-grid"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center px-4 pointer-events-none"
          >
            <div className="grid grid-cols-5 gap-4 sm:gap-5 max-w-6xl w-full mt-16 mb-24">
              {roster.map((slot, i) => (
                <motion.div
                  key={`${slot.player.id}-${i}`}
                  initial={{ y: 30, opacity: 0, rotate: -4 }}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  transition={{
                    delay: i * 0.04,
                    type: "spring",
                    stiffness: 240,
                    damping: 22,
                  }}
                  className="flex justify-center"
                >
                  <PlayerCard
                    player={slot.player}
                    rarity={slot.rarity}
                    showSockets={false}
                    large
                  />
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Continue CTA appears once the cards are revealed. */}
      {revealed && (
        <motion.button
          key="continue-cta"
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.45 }}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          type="button"
          onClick={onComplete}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 px-6 py-3 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest dugout-font-sport text-sm shadow-lg pointer-events-auto"
        >
          Head to the Front Office
        </motion.button>
      )}

      {/* "Tap to rip" fallback for the PACK state. If the canvas drops
          a click (touch device, imprecise tap target, slow first
          paint) this lets the user advance manually. The button is
          intentionally subtle so it doesn't compete with the primary
          "click the pack" interaction. */}
      {packState === "PACK" && (
        <button
          type="button"
          onClick={() => {
            const m = managerRef.current;
            if (m) m.setState("OPENING");
            else setPackState("REVEALED");
          }}
          className="absolute bottom-6 right-6 z-20 px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/15 border border-white/15 text-white/70 hover:text-white text-[10px] font-bold uppercase tracking-widest pointer-events-auto"
        >
          Tap to rip
        </button>
      )}
    </div>
  );
}
