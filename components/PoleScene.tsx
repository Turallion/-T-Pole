"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MutableRefObject, PointerEvent, useEffect, useMemo, useRef, useState, WheelEvent } from "react";
import * as THREE from "three";
import PosterOnPole from "@/components/PosterOnPole";
import {
  POLE_HEIGHT,
  POLE_RADIUS,
  POSTER_SURFACE_OFFSET
} from "@/components/poleConstants";
import type { PendingPoster, Poster } from "@/types/poster";

type CursorDirection = "left" | "front" | "right";

type StaplerCursorDirection = CursorDirection;
type SprayCanCursorDirection = CursorDirection;

const STAPLER_CURSOR_IMAGES: Record<StaplerCursorDirection, string> = {
  left: "/cursors/stapler-left.png",
  front: "/cursors/stapler-front.png",
  right: "/cursors/stapler-right.png"
};

const SPRAY_CAN_CURSOR_IMAGES: Record<SprayCanCursorDirection, string> = {
  left: "/cursors/spray-left.png",
  front: "/cursors/spray-front.png",
  right: "/cursors/spray-right.png"
};

const STAPLER_SOUND_URLS = [
  "/sounds/stapler-click-1.mp3",
  "/sounds/stapler-click-2.mp3",
  "/sounds/stapler-click-3.mp3",
  "/sounds/stapler-click-4.mp3"
];
const SPRAY_SOUND_URL = "/sounds/spray-can-paint-wood.wav";
const SPRAY_PASS_INTERVAL_MS = 900;
const SPRAY_SMOKE_INTERVAL_MS = 75;
const SPRAY_MOVE_SMOKE_INTERVAL_MS = 90;

type Props = {
  posters: Poster[];
  pendingPoster: PendingPoster | null;
  staplingPoster: Poster | null;
  sprayingPoster: Poster | null;
  sprayProgress: number;
  focusTarget: { id: string; angle: number; y: number } | null;
  soundEnabled: boolean;
  onAttach: (hit: { angle: number; y: number }) => void;
  onStaple: (hit: { angle: number; y: number }) => void;
  onSpray: (hit: { angle: number; y: number }, passes?: number) => void;
  placementDrop: { id: number; x: number; y: number } | null;
  onViewYChange?: (y: number) => void;
  onDropMiss: () => void;
  onStapleMiss: () => void;
  onSprayMiss: () => void;
};

export default function PoleScene({
  posters,
  pendingPoster,
  staplingPoster,
  sprayingPoster,
  sprayProgress,
  focusTarget,
  soundEnabled,
  onAttach,
  onStaple,
  onSpray,
  placementDrop,
  onViewYChange,
  onDropMiss,
  onStapleMiss,
  onSprayMiss
}: Props) {
  const [canvasKey, setCanvasKey] = useState(0);
  const [stapleClick, setStapleClick] = useState<{ id: number; x: number; y: number } | null>(null);
  const [sprayClick, setSprayClick] = useState<{ id: number; x: number; y: number; passes: number } | null>(null);
  const [staplerCursorPosition, setStaplerCursorPosition] = useState<{ x: number; y: number } | null>(null);
  const [sprayCursorPosition, setSprayCursorPosition] = useState<{ x: number; y: number } | null>(null);
  const [isSprayPressing, setIsSprayPressing] = useState(false);
  const [smokePuffs, setSmokePuffs] = useState<
    { id: number; x: number; y: number; size: number; opacity: number; duration: number }[]
  >([]);
  const [heightIndicatorY, setHeightIndicatorY] = useState(1.1);
  const [isHeightIndicatorVisible, setIsHeightIndicatorVisible] = useState(false);
  const rotationTarget = useRef(0);
  const viewYTarget = useRef(1.1);
  const heightIndicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sprayPassTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const spraySmokeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sprayCursorFrame = useRef<number | null>(null);
  const sprayPointer = useRef<{ x: number; y: number } | null>(null);
  const pendingSprayCursor = useRef<{ x: number; y: number } | null>(null);
  const lastMoveSmokeAt = useRef(0);
  const staplerSoundIndex = useRef(0);
  const activeStaplerSounds = useRef<HTMLAudioElement[]>([]);
  const spraySound = useRef<HTMLAudioElement | null>(null);
  const smokeId = useRef(0);
  const drag = useRef({
    active: false,
    x: 0,
    y: 0,
    moved: false
  });

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (staplingPoster) {
      setStaplerCursorPosition({ x: event.clientX, y: event.clientY });
      playStaplerSound();
    }

    if (sprayingPoster) {
      const point = { x: event.clientX, y: event.clientY };
      sprayPointer.current = point;
      setSprayCursorPosition(point);
      pendingSprayCursor.current = point;
      setIsSprayPressing(true);
      playSpraySound();
      addSmokeBurst(point, 10);
      startSpraySmoke();
      startSprayPasses();
    }

    drag.current = {
      active: true,
      x: event.clientX,
      y: event.clientY,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (staplingPoster) {
      setStaplerCursorPosition({ x: event.clientX, y: event.clientY });
    }

    if (sprayingPoster) {
      const point = { x: event.clientX, y: event.clientY };
      sprayPointer.current = point;
      scheduleSprayCursorPosition(point);

      if (drag.current.active) {
        const dx = event.clientX - drag.current.x;
        const dy = event.clientY - drag.current.y;
        const now = performance.now();

        if (Math.abs(dx) + Math.abs(dy) > 4 && now - lastMoveSmokeAt.current > SPRAY_MOVE_SMOKE_INTERVAL_MS) {
          lastMoveSmokeAt.current = now;
          addSmokeBurst(point, 4);
        }

        drag.current.x = event.clientX;
        drag.current.y = event.clientY;
        return;
      }
    }

    if (!drag.current.active) {
      return;
    }

    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;

    if (Math.abs(dx) + Math.abs(dy) > 2) {
      drag.current.moved = true;
    }

    rotationTarget.current += dx * 0.0085;
    const nextViewY = THREE.MathUtils.clamp(
      viewYTarget.current + dy * 0.018,
      -POLE_HEIGHT * 0.42,
      POLE_HEIGHT * 0.42
    );
    viewYTarget.current = nextViewY;
    onViewYChange?.(nextViewY);

    if (Math.abs(dy) > 0.5) {
      showHeightIndicator(nextViewY);
    }

    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
  }

  function startSprayPasses() {
    stopSprayPasses();
    sprayPassTimer.current = setInterval(() => {
      if (sprayPointer.current) {
        setSprayClick((current) => ({
          id: (current?.id ?? 0) + 1,
          x: sprayPointer.current?.x ?? 0,
          y: sprayPointer.current?.y ?? 0,
          passes: 1
        }));
      }
    }, SPRAY_PASS_INTERVAL_MS);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (drag.current.active) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (staplingPoster && !drag.current.moved) {
      setStapleClick((current) => ({
        id: (current?.id ?? 0) + 1,
        x: event.clientX,
        y: event.clientY
      }));
    } else if (sprayingPoster) {
      stopSprayPasses();
      stopSpraySmoke();
      stopSpraySound();
      setIsSprayPressing(false);
      setSprayClick((current) => ({
        id: (current?.id ?? 0) + 1,
        x: event.clientX,
        y: event.clientY,
        passes: 1
      }));
    }

    drag.current.active = false;
  }

  useEffect(() => {
    if (!staplingPoster) {
      setStaplerCursorPosition(null);
    }
  }, [staplingPoster]);

  useEffect(() => {
    if (!sprayingPoster) {
      setSprayCursorPosition(null);
      cancelSprayCursorFrame();
      setIsSprayPressing(false);
      stopSprayPasses();
      stopSpraySmoke();
      stopSpraySound();
    }
  }, [sprayingPoster]);

  useEffect(() => {
    if (!soundEnabled) {
      activeStaplerSounds.current.forEach((audio) => audio.pause());
      activeStaplerSounds.current = [];
      stopSpraySound();
    }
  }, [soundEnabled]);

  useEffect(() => {
    const sprayAudio = new Audio(SPRAY_SOUND_URL);
    sprayAudio.preload = "auto";
    sprayAudio.loop = true;
    sprayAudio.volume = 0.58;
    spraySound.current = sprayAudio;

    return () => {
      activeStaplerSounds.current.forEach((audio) => {
        audio.pause();
        audio.src = "";
      });
      activeStaplerSounds.current = [];
      sprayAudio.pause();
      sprayAudio.src = "";
      spraySound.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (heightIndicatorTimer.current) {
        clearTimeout(heightIndicatorTimer.current);
      }
      stopSprayPasses();
      stopSpraySmoke();
      stopSpraySound();
      cancelSprayCursorFrame();
    };
  }, []);

  function playStaplerSound() {
    if (!soundEnabled) {
      return;
    }

    const url = STAPLER_SOUND_URLS[staplerSoundIndex.current % STAPLER_SOUND_URLS.length];
    staplerSoundIndex.current += 1;
    const audio = new Audio(url);
    audio.volume = 0.95;
    activeStaplerSounds.current.push(audio);
    audio.addEventListener(
      "ended",
      () => {
        activeStaplerSounds.current = activeStaplerSounds.current.filter((item) => item !== audio);
      },
      { once: true }
    );
    void audio.play().catch(() => {
      activeStaplerSounds.current = activeStaplerSounds.current.filter((item) => item !== audio);
      // Some browsers block audio until the first trusted click; the next click will retry.
    });
  }

  function playSpraySound() {
    if (!soundEnabled) {
      return;
    }

    const audio = spraySound.current;

    if (!audio) {
      return;
    }

    if (!audio.paused) {
      return;
    }

    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Audio may be blocked until a direct user gesture in some browser modes.
    });
  }

  function stopSpraySound() {
    const audio = spraySound.current;

    if (!audio) {
      return;
    }

    audio.pause();
    audio.currentTime = 0;
  }

  function stopSprayPasses() {
    if (sprayPassTimer.current) {
      clearInterval(sprayPassTimer.current);
      sprayPassTimer.current = null;
    }
  }

  function startSpraySmoke() {
    stopSpraySmoke();
    spraySmokeTimer.current = setInterval(() => {
      if (sprayPointer.current) {
        addSmokeBurst(sprayPointer.current, 6);
      }
    }, SPRAY_SMOKE_INTERVAL_MS);
  }

  function scheduleSprayCursorPosition(point: { x: number; y: number }) {
    pendingSprayCursor.current = point;

    if (sprayCursorFrame.current !== null) {
      return;
    }

    sprayCursorFrame.current = window.requestAnimationFrame(() => {
      sprayCursorFrame.current = null;

      if (pendingSprayCursor.current) {
        setSprayCursorPosition(pendingSprayCursor.current);
      }
    });
  }

  function cancelSprayCursorFrame() {
    if (sprayCursorFrame.current === null) {
      return;
    }

    window.cancelAnimationFrame(sprayCursorFrame.current);
    sprayCursorFrame.current = null;
  }

  function stopSpraySmoke() {
    if (spraySmokeTimer.current) {
      clearInterval(spraySmokeTimer.current);
      spraySmokeTimer.current = null;
    }
  }

  function addSmokeBurst(point: { x: number; y: number }, count: number) {
    const puffs = Array.from({ length: count }).map((_, index) => {
      const id = smokeId.current + 1;
      smokeId.current = id;
      const spread = 16 + index * 3;

      return {
        id,
        x: point.x - 26 + (Math.random() - 0.5) * spread,
        y: point.y - 22 + (Math.random() - 0.5) * spread,
        size: 42 + Math.random() * 62,
        opacity: 0.58 + Math.random() * 0.28,
        duration: 980 + Math.random() * 480
      };
    });

    setSmokePuffs((current) => [...current.slice(-82), ...puffs]);
    window.setTimeout(() => {
      const ids = new Set(puffs.map((puff) => puff.id));
      setSmokePuffs((current) => current.filter((puff) => !ids.has(puff.id)));
    }, 1300);
  }

  function showHeightIndicator(y: number) {
    setHeightIndicatorY(y);
    setIsHeightIndicatorVisible(true);

    if (heightIndicatorTimer.current) {
      clearTimeout(heightIndicatorTimer.current);
    }

    heightIndicatorTimer.current = setTimeout(() => {
      setIsHeightIndicatorVisible(false);
    }, 850);
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    const nextViewY = THREE.MathUtils.clamp(
      viewYTarget.current - event.deltaY * 0.0045,
      -POLE_HEIGHT * 0.42,
      POLE_HEIGHT * 0.42
    );
    viewYTarget.current = nextViewY;
    onViewYChange?.(nextViewY);
    showHeightIndicator(nextViewY);
  }

  return (
    <div
      className={`h-full w-full touch-none ${
        staplingPoster
          ? "stapler-image-cursor"
          : sprayingPoster
            ? "spray-can-cursor"
            : pendingPoster
              ? "placement-hand-cursor"
              : ""
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
    >
      <Canvas
        key={canvasKey}
        camera={{ position: [0, 1.1, 5.6], fov: 42, near: 0.1, far: 80 }}
        dpr={1}
        gl={{
          antialias: true,
          alpha: true,
          preserveDrawingBuffer: true,
          powerPreference: "high-performance",
          stencil: false
        }}
        onCreated={({ gl }) => {
          gl.setClearAlpha(0);
          gl.domElement.addEventListener(
            "webglcontextlost",
            (event) => {
              event.preventDefault();
              window.setTimeout(() => setCanvasKey((key) => key + 1), 250);
            },
            false
          );
        }}
      >
        <fog attach="fog" args={["#f9f1df", 8, 22]} />
        <ambientLight intensity={1.25} />
        <directionalLight intensity={2.2} position={[4, 6, 5]} />
        <SceneContents
          posters={posters}
          pendingPoster={pendingPoster}
          staplingPoster={staplingPoster}
          sprayingPoster={sprayingPoster}
          sprayProgress={sprayProgress}
          focusTarget={focusTarget}
          soundEnabled={soundEnabled}
          rotationTarget={rotationTarget}
          viewYTarget={viewYTarget}
          onAttach={onAttach}
          onStaple={onStaple}
          onSpray={onSpray}
          placementDrop={placementDrop}
          onViewYChange={onViewYChange}
          stapleClick={stapleClick}
          sprayClick={sprayClick}
          onDropMiss={onDropMiss}
          onStapleMiss={onStapleMiss}
          onSprayMiss={onSprayMiss}
        />
      </Canvas>

      <PoleHeightIndicator y={heightIndicatorY} visible={isHeightIndicatorVisible} />

      {staplingPoster && staplerCursorPosition ? (
        <StaplerPlacementCursor position={staplerCursorPosition} />
      ) : null}

      {sprayingPoster && sprayCursorPosition ? (
        <SprayCanPlacementCursor position={sprayCursorPosition} isPressing={isSprayPressing} />
      ) : null}

      {smokePuffs.map((puff) => (
        <SmokePuff
          key={puff.id}
          x={puff.x}
          y={puff.y}
          size={puff.size}
          opacity={puff.opacity}
          duration={puff.duration}
        />
      ))}
    </div>
  );
}

function StaplerPlacementCursor({ position }: { position: { x: number; y: number } }) {
  const direction = getStaplerCursorDirection(position.x);
  const offset = getStaplerCursorOffset(direction);

  return (
    <>
      <img
        src={STAPLER_CURSOR_IMAGES[direction]}
        alt=""
        className="pointer-events-none fixed z-40 h-[220px] w-auto -translate-x-1/2 -translate-y-1/2 select-none opacity-95 drop-shadow-[0_8px_14px_rgba(0,0,0,0.24)] sm:h-[300px]"
        style={{ left: position.x + offset.x, top: position.y + offset.y }}
      />
      <div
        className="pointer-events-none fixed z-50 size-10 -translate-x-1/2 -translate-y-1/2 select-none"
        style={{ left: position.x, top: position.y }}
        aria-hidden="true"
      >
        <span className="absolute left-1/2 top-1/2 h-10 w-[7px] -translate-x-1/2 -translate-y-1/2 bg-white shadow-[0_0_0_1px_rgba(22,32,27,0.35)]" />
        <span className="absolute left-1/2 top-1/2 h-[7px] w-10 -translate-x-1/2 -translate-y-1/2 bg-white shadow-[0_0_0_1px_rgba(22,32,27,0.35)]" />
        <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 bg-white" />
      </div>
    </>
  );
}

function SprayCanPlacementCursor({
  position,
  isPressing
}: {
  position: { x: number; y: number };
  isPressing: boolean;
}) {
  const direction = getSprayCanCursorDirection(position.x);
  const offset = getSprayCanCursorOffset(direction);

  return (
    <>
      <img
        src={SPRAY_CAN_CURSOR_IMAGES[direction]}
        alt=""
        className={`pointer-events-none fixed z-40 h-[220px] w-auto -translate-x-1/2 -translate-y-1/2 select-none opacity-95 drop-shadow-[0_8px_14px_rgba(0,0,0,0.24)] sm:h-[300px] ${
          isPressing ? "scale-[0.97]" : ""
        }`}
        style={{ left: position.x + offset.x, top: position.y + offset.y }}
      />
      {!isPressing ? (
        <div
          className="pointer-events-none fixed z-50 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-[5px] border-white shadow-[0_0_0_1px_rgba(22,32,27,0.35),0_2px_8px_rgba(0,0,0,0.24)]"
          style={{ left: position.x, top: position.y }}
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}

function SmokePuff({
  x,
  y,
  size,
  opacity,
  duration
}: {
  x: number;
  y: number;
  size: number;
  opacity: number;
  duration: number;
}) {
  return (
    <div
      className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2"
      style={{ left: x, top: y }}
      aria-hidden="true"
    >
      <span
        className="absolute rounded-full bg-white blur-md"
        style={{
          width: size,
          height: size,
          opacity,
          animation: `spraySmoke ${duration}ms ease-out forwards`
        }}
      />
      <span
        className="absolute -left-4 top-2 rounded-full bg-white blur-md"
        style={{
          width: size * 0.72,
          height: size * 0.72,
          opacity: opacity * 0.8,
          animation: `spraySmoke ${duration + 160}ms ease-out forwards`
        }}
      />
    </div>
  );
}

function PoleHeightIndicator({ y, visible }: { y: number; visible: boolean }) {
  const maxY = POLE_HEIGHT * 0.42;
  const progress = THREE.MathUtils.clamp((maxY - y) / (maxY * 2), 0, 1);

  return (
    <div
      className={`pointer-events-none fixed left-4 top-1/2 z-30 h-28 w-3 -translate-y-1/2 transition-opacity duration-200 sm:left-6 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      aria-hidden="true"
    >
      <div className="absolute left-1/2 top-0 h-full w-1 -translate-x-1/2 rounded-full border border-[#16201b]/20 bg-[#fff8e8]/50 shadow-[1px_1px_0_rgba(22,32,27,0.18)] backdrop-blur-sm" />
      <div
        className="absolute left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 border border-[#16201b] bg-[#ffcf57] shadow-[1px_1px_0_#16201b]"
        style={{ top: `${progress * 100}%` }}
      />
    </div>
  );
}

type SceneContentsProps = Props & {
  rotationTarget: MutableRefObject<number>;
  viewYTarget: MutableRefObject<number>;
  stapleClick: { id: number; x: number; y: number } | null;
  sprayClick: { id: number; x: number; y: number; passes: number } | null;
};

function SceneContents({
  posters,
  pendingPoster,
  staplingPoster,
  sprayingPoster,
  sprayProgress,
  focusTarget,
  rotationTarget,
  viewYTarget,
  onAttach,
  onStaple,
  onSpray,
  placementDrop,
  onViewYChange,
  stapleClick,
  sprayClick,
  onDropMiss,
  onStapleMiss,
  onSprayMiss,
}: SceneContentsProps) {
  const groupRef = useRef<THREE.Group>(null);
  const poleRef = useRef<THREE.Mesh>(null);
  const processedDropId = useRef<number | null>(null);
  const processedStapleClickId = useRef<number | null>(null);
  const processedSprayClickId = useRef<number | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const graffitiMaskRef = useRef<{ canvas: HTMLCanvasElement; width: number; height: number } | null>(null);
  const woodTexture = useWoodTexture();
  const { camera, gl } = useThree();

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = THREE.MathUtils.damp(
        groupRef.current.rotation.y,
        rotationTarget.current,
        8,
        delta
      );
    }

    camera.position.y = THREE.MathUtils.damp(
      camera.position.y,
      viewYTarget.current,
      6,
      delta
    );
    camera.lookAt(0, camera.position.y, 0);
  });

  useEffect(() => {
    graffitiMaskRef.current = null;

    if (!sprayingPoster?.image_url) {
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) {
        return;
      }

      const width = 512;
      const height = Math.max(256, Math.round(width * (sprayingPoster.height / sprayingPoster.width)));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      const padding = Math.min(width, height) * 0.05;
      drawImageContainForMask(context, image, padding, padding, width - padding * 2, height - padding * 2);
      graffitiMaskRef.current = { canvas, width, height };
    };
    image.src = sprayingPoster.image_url;

    return () => {
      cancelled = true;
    };
  }, [sprayingPoster?.height, sprayingPoster?.image_url, sprayingPoster?.width]);

  useEffect(() => {
    if (!focusTarget) {
      return;
    }

    rotationTarget.current = -focusTarget.angle;
    viewYTarget.current = THREE.MathUtils.clamp(
      focusTarget.y,
      -POLE_HEIGHT * 0.42,
      POLE_HEIGHT * 0.42
    );
    onViewYChange?.(viewYTarget.current);
  }, [focusTarget, onViewYChange, rotationTarget, viewYTarget]);

  useEffect(() => {
    if (!placementDrop || !pendingPoster || !poleRef.current) {
      return;
    }

    if (processedDropId.current === placementDrop.id) {
      return;
    }

    processedDropId.current = placementDrop.id;
    const bounds = gl.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((placementDrop.x - bounds.left) / bounds.width) * 2 - 1,
      -((placementDrop.y - bounds.top) / bounds.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObject(poleRef.current, false);

    if (!hit) {
      onDropMiss();
      return;
    }

    attachAtPoint(hit.point);
  }, [attachAtPoint, camera, gl.domElement, onDropMiss, pendingPoster, placementDrop, raycaster]);

  useEffect(() => {
    if (!stapleClick || !staplingPoster || !poleRef.current) {
      return;
    }

    if (processedStapleClickId.current === stapleClick.id) {
      return;
    }

    processedStapleClickId.current = stapleClick.id;
    const bounds = gl.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((stapleClick.x - bounds.left) / bounds.width) * 2 - 1,
      -((stapleClick.y - bounds.top) / bounds.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObject(poleRef.current, false);

    if (!hit) {
      onStapleMiss();
      return;
    }

    stapleAtPoint(hit.point);
  }, [camera, gl.domElement, onStapleMiss, raycaster, stapleAtPoint, stapleClick, staplingPoster]);

  useEffect(() => {
    if (!sprayClick || !sprayingPoster || !poleRef.current) {
      return;
    }

    if (processedSprayClickId.current === sprayClick.id) {
      return;
    }

    processedSprayClickId.current = sprayClick.id;
    const bounds = gl.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((sprayClick.x - bounds.left) / bounds.width) * 2 - 1,
      -((sprayClick.y - bounds.top) / bounds.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObject(poleRef.current, false);

    if (!hit) {
      onSprayMiss();
      return;
    }

    sprayAtPoint(hit.point, sprayClick.passes);
  }, [camera, gl.domElement, onSprayMiss, raycaster, sprayAtPoint, sprayClick, sprayingPoster]);

  function attachAtPoint(point: THREE.Vector3) {
    if (!pendingPoster || !poleRef.current) {
      return;
    }

    const localPoint = poleRef.current.worldToLocal(point.clone());
    const y = THREE.MathUtils.clamp(
      localPoint.y,
      -POLE_HEIGHT / 2 + pendingPoster.height / 2,
      POLE_HEIGHT / 2 - pendingPoster.height / 2
    );
    const angle = Math.atan2(localPoint.x, localPoint.z);
    onAttach({
      angle: Number(angle.toFixed(5)),
      y: Number(y.toFixed(5))
    });
  }

  function stapleAtPoint(point: THREE.Vector3) {
    if (!staplingPoster || !poleRef.current) {
      return;
    }

    const localPoint = poleRef.current.worldToLocal(point.clone());
    const angle = Math.atan2(localPoint.x, localPoint.z);
    const angleDelta = Math.abs(normalizeAngle(angle - staplingPoster.angle));
    const halfAngle = staplingPoster.width / (2 * POLE_RADIUS);
    const halfHeight = staplingPoster.height / 2;

    if (
      angleDelta > halfAngle ||
      localPoint.y < staplingPoster.y - halfHeight ||
      localPoint.y > staplingPoster.y + halfHeight
    ) {
      onStapleMiss();
      return;
    }

    onStaple({
      angle: Number(angle.toFixed(5)),
      y: Number(localPoint.y.toFixed(5))
    });
  }

  function sprayAtPoint(point: THREE.Vector3, passes = 1) {
    if (!sprayingPoster || !poleRef.current) {
      return;
    }

    const localPoint = poleRef.current.worldToLocal(point.clone());
    const angle = Math.atan2(localPoint.x, localPoint.z);

    if (!isPointInsideGraffitiAlpha(angle, localPoint.y, sprayingPoster, graffitiMaskRef.current)) {
      onSprayMiss();
      return;
    }

    onSpray({
      angle: Number(angle.toFixed(5)),
      y: Number(localPoint.y.toFixed(5))
    }, passes);
  }

  return (
    <group ref={groupRef}>
      <mesh ref={poleRef}>
        <cylinderGeometry args={[POLE_RADIUS, POLE_RADIUS, POLE_HEIGHT, 96, 12]} />
        <meshStandardMaterial
          map={woodTexture.map}
          bumpMap={woodTexture.bumpMap}
          bumpScale={0.07}
          roughness={0.36}
          metalness={0}
          color="#ffffff"
        />
      </mesh>

      <mesh position={[0, -POLE_HEIGHT / 2 - 0.12, 0]}>
        <cylinderGeometry args={[1.18, 1.3, 0.24, 96]} />
        <meshStandardMaterial color="#725131" roughness={0.9} />
      </mesh>

      <group position={[0, 0, 0]}>
        {posters.map((poster, index) => (
          <PosterOnPole
            key={poster.id}
            poster={poster}
            stackIndex={index}
            occludingPosters={posters.slice(index + 1)}
          />
        ))}
        {staplingPoster ? (
          <PosterOnPole poster={staplingPoster} stackIndex={posters.length} />
        ) : null}
        {sprayingPoster ? (
          <PosterOnPole
            poster={sprayingPoster}
            stackIndex={posters.length}
            revealProgress={sprayProgress}
            showOutline
          />
        ) : null}
      </group>
    </group>
  );
}

function getStaplerCursorDirection(x: number): StaplerCursorDirection {
  if (typeof window === "undefined") {
    return "front";
  }

  const center = window.innerWidth / 2;
  const centerZone = Math.min(64, window.innerWidth * 0.045);

  if (x < center - centerZone) {
    return "left";
  }

  if (x > center + centerZone) {
    return "right";
  }

  return "front";
}

function getStaplerCursorOffset(direction: StaplerCursorDirection) {
  if (isCompactViewport()) {
    const compactOffsets: Record<StaplerCursorDirection, { x: number; y: number }> = {
      left: { x: -76, y: 20 },
      front: { x: 58, y: 22 },
      right: { x: 76, y: 20 }
    };

    return compactOffsets[direction];
  }

  const offsets: Record<StaplerCursorDirection, { x: number; y: number }> = {
    left: { x: -150, y: 28 },
    front: { x: 112, y: 34 },
    right: { x: 150, y: 28 }
  };

  return offsets[direction];
}

function getSprayCanCursorDirection(x: number): SprayCanCursorDirection {
  return getStaplerCursorDirection(x);
}

function getSprayCanCursorOffset(direction: SprayCanCursorDirection) {
  if (isCompactViewport()) {
    const compactOffsets: Record<SprayCanCursorDirection, { x: number; y: number }> = {
      left: { x: -68, y: 54 },
      front: { x: 62, y: 56 },
      right: { x: 68, y: 54 }
    };

    return compactOffsets[direction];
  }

  const offsets: Record<SprayCanCursorDirection, { x: number; y: number }> = {
    left: { x: -130, y: 90 },
    front: { x: 120, y: 94 },
    right: { x: 130, y: 90 }
  };

  return offsets[direction];
}

function isCompactViewport() {
  return typeof window !== "undefined" && window.innerWidth < 640;
}

function normalizeAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function isPointInsidePoster(angle: number, y: number, poster: Poster) {
  const angleDelta = Math.abs(normalizeAngle(angle - poster.angle));
  const halfAngle = poster.width / (2 * POLE_RADIUS);
  const halfHeight = poster.height / 2;

  return (
    angleDelta <= halfAngle &&
    y >= poster.y - halfHeight &&
    y <= poster.y + halfHeight
  );
}

function isPointInsideGraffitiAlpha(
  angle: number,
  y: number,
  poster: Poster,
  mask: { canvas: HTMLCanvasElement; width: number; height: number } | null
) {
  if (!isPointInsidePoster(angle, y, poster)) {
    return false;
  }

  if (!mask) {
    return true;
  }

  const angleDelta = normalizeAngle(angle - poster.angle);
  const halfAngle = poster.width / (2 * POLE_RADIUS);
  const u = THREE.MathUtils.clamp((angleDelta + halfAngle) / (halfAngle * 2), 0, 1);
  const v = THREE.MathUtils.clamp(1 - (y - (poster.y - poster.height / 2)) / poster.height, 0, 1);
  const context = mask.canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return true;
  }

  const x = Math.min(mask.width - 1, Math.max(0, Math.round(u * (mask.width - 1))));
  const pixelY = Math.min(mask.height - 1, Math.max(0, Math.round(v * (mask.height - 1))));
  return context.getImageData(x, pixelY, 1, 1).data[3] > 24;
}

function drawImageContainForMask(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const boxRatio = width / height;
  const drawWidth = imageRatio > boxRatio ? width : height * imageRatio;
  const drawHeight = imageRatio > boxRatio ? width / imageRatio : height;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;

  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

function PendingPlacementHalo({ viewYTarget }: { viewYTarget: MutableRefObject<number> }) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }, delta) => {
    if (!ref.current) {
      return;
    }

    ref.current.position.y = THREE.MathUtils.damp(
      ref.current.position.y,
      viewYTarget.current,
      5,
      delta
    );
    const pulse = 1 + Math.sin(clock.elapsedTime * 4) * 0.02;
    ref.current.scale.set(pulse, 1, pulse);
  });

  return (
    <mesh ref={ref} position={[0, viewYTarget.current, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[POLE_RADIUS + POSTER_SURFACE_OFFSET + 0.025, 0.01, 8, 96]} />
      <meshStandardMaterial color="#ffcf57" emissive="#ffcf57" emissiveIntensity={0.3} />
    </mesh>
  );
}

function useWoodTexture() {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 3072;
    const context = canvas.getContext("2d");

    if (!context) {
      const fallback = new THREE.Texture();
      return { map: fallback, bumpMap: fallback };
    }

    const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
    gradient.addColorStop(0, "#271008");
    gradient.addColorStop(0.08, "#552714");
    gradient.addColorStop(0.22, "#9b5a35");
    gradient.addColorStop(0.36, "#3b190d");
    gradient.addColorStop(0.52, "#8d4728");
    gradient.addColorStop(0.68, "#4a2011");
    gradient.addColorStop(0.82, "#7f3f23");
    gradient.addColorStop(1, "#2a1008");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const bumpCanvas = document.createElement("canvas");
    bumpCanvas.width = canvas.width;
    bumpCanvas.height = canvas.height;
    const bumpContext = bumpCanvas.getContext("2d");

    if (bumpContext) {
      bumpContext.fillStyle = "#565656";
      bumpContext.fillRect(0, 0, bumpCanvas.width, bumpCanvas.height);
    }

    for (let i = 0; i < 280; i += 1) {
      const x = seededNoise(i, 3) * canvas.width;
      const width = 1 + seededNoise(i, 7) * 9;
      const darkAlpha = 0.18 + seededNoise(i, 11) * 0.34;
      const waveAmount = 5 + seededNoise(i, 13) * 20;
      context.strokeStyle = `rgba(22, 8, 3, ${darkAlpha})`;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(x, 0);

      for (let y = 0; y <= canvas.height; y += 56) {
        const wave = Math.sin(y * 0.009 + i) * waveAmount + Math.sin(y * 0.026 + i) * 5;
        context.lineTo(x + wave, y);
      }

      context.stroke();

      if (bumpContext) {
        bumpContext.strokeStyle = seededNoise(i, 17) > 0.56 ? "#202020" : "#8d8d8d";
        bumpContext.lineWidth = Math.max(1, width * 0.75);
        bumpContext.beginPath();
        bumpContext.moveTo(x, 0);

        for (let y = 0; y <= canvas.height; y += 56) {
          const wave = Math.sin(y * 0.009 + i) * waveAmount + Math.sin(y * 0.026 + i) * 5;
          bumpContext.lineTo(x + wave, y);
        }

        bumpContext.stroke();
      }
    }

    for (let i = 0; i < 48; i += 1) {
      const x = seededNoise(i, 23) * canvas.width;
      const width = 5 + seededNoise(i, 29) * 18;
      const alpha = 0.04 + seededNoise(i, 31) * 0.12;
      context.strokeStyle = `rgba(244, 177, 122, ${alpha})`;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(x, 0);

      for (let y = 0; y <= canvas.height; y += 120) {
        const wave = Math.sin(y * 0.006 + i) * 18 + Math.sin(y * 0.018 + i) * 7;
        context.lineTo(x + wave, y);
      }

      context.stroke();
    }

    for (let i = 0; i < 13; i += 1) {
      const x = seededNoise(i, 37) * canvas.width;
      const y = seededNoise(i, 41) * canvas.height;
      const radius = 18 + seededNoise(i, 43) * 44;
      context.save();
      context.translate(x, y);
      context.scale(1.7, 0.8);
      context.fillStyle = "rgba(18, 5, 1, 0.36)";
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(214, 137, 82, 0.28)";
      context.lineWidth = 7;
      context.stroke();
      context.restore();

      if (bumpContext) {
        bumpContext.save();
        bumpContext.translate(x, y);
        bumpContext.scale(1.7, 0.8);
        bumpContext.fillStyle = "#1f1f1f";
        bumpContext.beginPath();
        bumpContext.arc(0, 0, radius, 0, Math.PI * 2);
        bumpContext.fill();
        bumpContext.restore();
      }
    }

    context.globalCompositeOperation = "multiply";
    context.fillStyle = "rgba(40, 10, 4, 0.1)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "source-over";

    for (let i = 0; i < 18; i += 1) {
      const x = seededNoise(i, 53) * canvas.width;
      const width = 1 + seededNoise(i, 59) * 3;
      context.strokeStyle = "rgba(255, 226, 190, 0.14)";
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + Math.sin(i) * 28, canvas.height);
      context.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.35, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    bumpTexture.wrapS = THREE.RepeatWrapping;
    bumpTexture.wrapT = THREE.RepeatWrapping;
    bumpTexture.repeat.set(1.35, 1);
    bumpTexture.needsUpdate = true;
    return { map: texture, bumpMap: bumpTexture };
  }, []);
}

function seededNoise(seed: number, salt: number) {
  const value = Math.sin(seed * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}
