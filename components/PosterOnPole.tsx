"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import {
  POLE_RADIUS,
  POSTER_SURFACE_OFFSET
} from "@/components/poleConstants";
import type { Poster } from "@/types/poster";

type Props = {
  poster: Poster;
  stackIndex: number;
  revealProgress?: number;
  showOutline?: boolean;
  occludingPosters?: Poster[];
};

const paperColors = ["#fff7ce", "#ffd5d0", "#cdf6de", "#d8efff", "#f6e2ff", "#ffffff"];
const GEOMETRY_SEGMENTS = 32;
const STACK_OFFSET = 0.009;
const STAPLE_SURFACE_LIFT = 0.003;
const POSTER_TEXTURE_WIDTH = 1024;
const GRAFFITI_TEXTURE_WIDTH = 768;
const MAX_TEXTURE_HEIGHT = 1536;

export default function PosterOnPole({
  poster,
  stackIndex,
  revealProgress = 1,
  showOutline = false,
  occludingPosters = []
}: Props) {
  const isGraffiti = poster.type === "graffiti";
  const surfaceOffset = POSTER_SURFACE_OFFSET + stackIndex * STACK_OFFSET;
  const stapleMarks = useMemo(
    () =>
      isGraffiti
        ? []
        : (poster.staples ?? []).filter(
            (staple) => !occludingPosters.some((occluder) => isPointInsidePoster(staple.angle, staple.y, occluder))
          ),
    [isGraffiti, occludingPosters, poster.staples]
  );
  const color = useMemo(
    () => poster.color || (isGraffiti ? "#f6f0d8" : pickColor(poster.id)),
    [isGraffiti, poster.color, poster.id]
  );
  const texture = usePosterTexture(poster, color, isGraffiti, revealProgress, showOutline);
  const geometry = useMemo(
    () => createCurvedPosterGeometry(poster, surfaceOffset),
    [poster, surfaceOffset]
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  return (
    <group>
      <mesh geometry={geometry} renderOrder={20 + stackIndex}>
        <meshStandardMaterial
          map={texture}
          color="#ffffff"
          roughness={isGraffiti ? 0.72 : 0.96}
          side={THREE.FrontSide}
          transparent={isGraffiti}
          alphaTest={isGraffiti ? 0.015 : 0}
          depthWrite={!isGraffiti}
          polygonOffset
          polygonOffsetFactor={-2 - stackIndex * 0.08}
          polygonOffsetUnits={-4 - stackIndex}
        />
      </mesh>

      {!isGraffiti ? (
        <>
          {stapleMarks.map((staple, index) => (
            <Staple
              key={`${staple.angle}:${staple.y}:${index}`}
              angle={staple.angle}
              y={staple.y}
              surfaceOffset={surfaceOffset}
              stackIndex={stackIndex}
            />
          ))}
        </>
      ) : null}
    </group>
  );
}

function Staple({
  angle,
  y,
  surfaceOffset,
  stackIndex
}: {
  angle: number;
  y: number;
  surfaceOffset: number;
  stackIndex: number;
}) {
  const radius = POLE_RADIUS + surfaceOffset + STAPLE_SURFACE_LIFT + stackIndex * 0.00008;
  return (
    <mesh
      position={[Math.sin(angle) * radius, y, Math.cos(angle) * radius]}
      rotation={[0, angle, 0]}
      renderOrder={20 + stackIndex}
    >
      <boxGeometry args={[0.082, 0.018, 0.012]} />
      <meshStandardMaterial color="#c8ced4" metalness={0.86} roughness={0.24} />
    </mesh>
  );
}

function isPointInsidePoster(angle: number, y: number, poster: Poster) {
  const angleDelta = Math.abs(normalizeAngle(angle - poster.angle));
  const halfAngle = poster.width / (2 * POLE_RADIUS);
  const halfHeight = poster.height / 2;

  return angleDelta <= halfAngle && y >= poster.y - halfHeight && y <= poster.y + halfHeight;
}

function normalizeAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function createCurvedPosterGeometry(poster: Poster, surfaceOffset: number) {
  const radius = POLE_RADIUS + surfaceOffset;
  const angleSpan = poster.width / POLE_RADIUS;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row <= 1; row += 1) {
    const rowProgress = row;
    const y = poster.y + poster.height / 2 - rowProgress * poster.height;

    for (let column = 0; column <= GEOMETRY_SEGMENTS; column += 1) {
      const columnProgress = column / GEOMETRY_SEGMENTS;
      const theta = poster.angle + (columnProgress - 0.5) * angleSpan;
      const normalX = Math.sin(theta);
      const normalZ = Math.cos(theta);

      positions.push(normalX * radius, y, normalZ * radius);
      normals.push(normalX, 0, normalZ);
      uvs.push(columnProgress, 1 - rowProgress);
    }
  }

  for (let column = 0; column < GEOMETRY_SEGMENTS; column += 1) {
    const topLeft = column;
    const topRight = column + 1;
    const bottomLeft = GEOMETRY_SEGMENTS + 1 + column;
    const bottomRight = bottomLeft + 1;

    indices.push(topLeft, bottomLeft, topRight);
    indices.push(topRight, bottomLeft, bottomRight);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return geometry;
}

function usePosterTexture(
  poster: Poster,
  color: string,
  isGraffiti: boolean,
  revealProgress: number,
  showOutline: boolean
) {
  const [texture, setTexture] = useState(() =>
    createPosterTexture(poster, color, isGraffiti, revealProgress, showOutline)
  );

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    let currentTexture = createPosterTexture(poster, color, isGraffiti, revealProgress, showOutline);
    setTexture(currentTexture);

    if (!poster.image_url) {
      return () => {
        currentTexture.dispose();
      };
    }

    loadPosterImage(poster.image_url)
      .then(({ image, objectUrl: loadedObjectUrl }) => {
        if (cancelled) {
          if (loadedObjectUrl) {
            URL.revokeObjectURL(loadedObjectUrl);
          }
          return;
        }

        objectUrl = loadedObjectUrl ?? null;
        const nextTexture = createPosterTexture(poster, color, isGraffiti, revealProgress, showOutline, image);
        setTexture((previous) => {
          previous.dispose();
          return nextTexture;
        });
        currentTexture = nextTexture;
      })
      .catch((error) => {
        console.warn("Poster image failed to load.", error);
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      currentTexture.dispose();
    };
  }, [color, isGraffiti, poster, revealProgress, showOutline]);

  return texture;
}

function createPosterTexture(
  poster: Poster,
  color: string,
  isGraffiti: boolean,
  revealProgress: number,
  showOutline: boolean,
  image?: HTMLImageElement
) {
  const width = isGraffiti ? GRAFFITI_TEXTURE_WIDTH : POSTER_TEXTURE_WIDTH;
  const minHeight = isGraffiti ? 384 : 512;
  const height = Math.min(
    MAX_TEXTURE_HEIGHT,
    Math.max(minHeight, Math.round(width * (poster.height / poster.width)))
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return configureCanvasTexture(new THREE.CanvasTexture(canvas), isGraffiti);
  }

  if (isGraffiti) {
    drawGraffitiTexture(context, width, height, revealProgress, showOutline, image);
    return configureCanvasTexture(new THREE.CanvasTexture(canvas), true);
  }

  context.fillStyle = color;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(22, 32, 27, 0.16)";
  context.lineWidth = 5;
  context.strokeRect(3, 3, width - 6, height - 6);

  const hasText = Boolean(poster.text);
  const hasImage = Boolean(image && poster.image_url);
  const hasContact = Boolean(poster.contact);
  const padding = width * 0.09;
  const contentTop = padding;
  const contentWidth = width - padding * 2;
  const bottomGap = Math.max(10, height * 0.025);
  const contactHeight = hasContact ? height * 0.16 : 0;
  const contentHeight = height - contentTop - contactHeight - bottomGap;

  if (hasImage && image) {
    const imageHeight = hasText ? contentHeight * 0.62 : contentHeight;
    drawContainImage(context, image, padding, contentTop, contentWidth, imageHeight, false);
  }

  if (hasText && poster.text) {
    const textTop = hasImage ? contentTop + contentHeight * 0.66 : contentTop;
    const textHeight = hasImage ? contentHeight * 0.3 : contentHeight;
    drawWrappedText(context, poster.text, {
      x: padding,
      y: textTop,
      width: contentWidth,
      height: textHeight,
      fontSize: hasImage ? 60 : 92
    });
  }

  if (hasContact && poster.contact) {
    drawContact(context, poster.contact, {
      x: padding,
      y: height - contactHeight - bottomGap,
      width: contentWidth,
      height: contactHeight
    });
  }

  return configureCanvasTexture(new THREE.CanvasTexture(canvas), false);
}

function configureCanvasTexture(texture: THREE.CanvasTexture, isGraffiti: boolean) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = isGraffiti ? 1 : 4;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return texture;
}

async function loadPosterImage(url: string): Promise<{ image: HTMLImageElement; objectUrl?: string }> {
  try {
    return { image: await loadImageElement(url, true) };
  } catch {
    const response = await fetch(url, { cache: "force-cache", mode: "cors" });

    if (!response.ok) {
      throw new Error(`Could not fetch poster image: ${response.status}`);
    }

    const objectUrl = URL.createObjectURL(await response.blob());

    try {
      return { image: await loadImageElement(objectUrl, false), objectUrl };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }
}

function loadImageElement(src: string, useCors: boolean) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    if (useCors) {
      image.crossOrigin = "anonymous";
      image.referrerPolicy = "no-referrer";
    }

    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode poster image."));
    image.src = src;
  });
}

function drawGraffitiTexture(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  revealProgress: number,
  showOutline: boolean,
  image?: HTMLImageElement
) {
  context.clearRect(0, 0, width, height);

  if (image) {
    const padding = Math.min(width, height) * 0.05;

    if (showOutline) {
      drawGraffitiAlphaOutline(
        context,
        image,
        padding,
        padding,
        width - padding * 2,
        height - padding * 2
      );
    }

    context.save();
    context.globalAlpha = THREE.MathUtils.clamp(revealProgress, 0, 1);
    drawContainImage(
      context,
      image,
      padding,
      padding,
      width - padding * 2,
      height - padding * 2,
      false
    );
    context.restore();
    return;
  }

  if (showOutline) {
    const inset = Math.max(16, Math.min(width, height) * 0.035);
    context.save();
    context.setLineDash([34, 22]);
    context.lineWidth = Math.max(8, Math.min(width, height) * 0.018);
    context.strokeStyle = "rgba(255, 207, 87, 0.92)";
    context.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
    context.setLineDash([]);
    context.lineWidth = Math.max(3, Math.min(width, height) * 0.007);
    context.strokeStyle = "rgba(22, 32, 27, 0.62)";
    context.strokeRect(inset + 6, inset + 6, width - inset * 2 - 12, height - inset * 2 - 12);
    context.restore();
  }
}

function drawGraffitiAlphaOutline(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const offset = Math.max(10, Math.min(width, height) * 0.018);
  const offsets = [
    [-offset, 0],
    [offset, 0],
    [0, -offset],
    [0, offset],
    [-offset * 0.7, -offset * 0.7],
    [offset * 0.7, -offset * 0.7],
    [-offset * 0.7, offset * 0.7],
    [offset * 0.7, offset * 0.7]
  ];

  context.save();
  context.globalAlpha = 0.9;
  context.filter = `drop-shadow(0 0 ${offset}px rgba(255, 207, 87, 0.9))`;
  offsets.forEach(([dx, dy]) => {
    drawContainImage(context, image, x + dx, y + dy, width, height, false);
  });
  context.globalCompositeOperation = "source-in";
  context.fillStyle = "rgba(255, 207, 87, 0.92)";
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  context.restore();
}

function drawContainImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  fillBackground = true
) {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const boxRatio = width / height;
  const drawWidth = imageRatio > boxRatio ? width : height * imageRatio;
  const drawHeight = imageRatio > boxRatio ? width / imageRatio : height;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;

  if (fillBackground) {
    context.fillStyle = "rgba(255, 255, 255, 0.58)";
    context.fillRect(x, y, width, height);
  }

  context.drawImage(
    image,
    drawX,
    drawY,
    drawWidth,
    drawHeight
  );
}

function drawContact(
  context: CanvasRenderingContext2D,
  contact: string,
  box: { x: number; y: number; width: number; height: number }
) {
  const formattedContact = formatContactForDisplay(contact);
  const centerX = box.x + box.width / 2;
  const labelY = box.y + box.height * 0.32;
  const handleY = box.y + box.height * 0.68;

  context.save();
  context.fillStyle = "rgba(255, 255, 255, 0.2)";
  context.fillRect(box.x, box.y + box.height * 0.08, box.width, box.height * 0.84);
  context.restore();

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";

  context.font = `900 ${Math.max(22, Math.min(42, box.height * 0.18))}px Arial, sans-serif`;
  context.strokeStyle = "rgba(255, 255, 255, 0.65)";
  context.lineWidth = 4;
  context.strokeText("contact:", centerX, labelY, box.width);
  context.fillStyle = "rgba(22, 32, 27, 0.84)";
  context.fillText("contact:", centerX, labelY, box.width);

  context.font = `900 ${Math.max(34, Math.min(60, box.height * 0.29))}px Arial, sans-serif`;
  context.strokeStyle = "rgba(255, 255, 255, 0.78)";
  context.lineWidth = 6;
  context.strokeText(formattedContact, centerX, handleY, box.width);
  context.fillStyle = "rgba(22, 32, 27, 0.92)";
  context.fillText(formattedContact, centerX, handleY, box.width);
}

function formatContactForDisplay(contact: string) {
  const normalized = contact.trim().toLowerCase().replace(/\s+/g, "");
  return normalized.startsWith("@") ? normalized : `@${normalized}`;
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  box: { x: number; y: number; width: number; height: number; fontSize: number }
) {
  let fontSize = box.fontSize;
  let lines: string[] = [];
  let lineHeight = fontSize * 1.12;

  do {
    context.font = `900 ${fontSize}px Arial, sans-serif`;
    lines = wrapText(context, text, box.width);
    lineHeight = fontSize * 1.12;
    fontSize -= 4;
  } while (lines.length * lineHeight > box.height && fontSize > 24);

  context.fillStyle = "#16201b";
  context.textAlign = "center";
  context.textBaseline = "middle";

  const firstLineY = box.y + box.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    context.fillText(line, box.x + box.width / 2, firstLineY + index * lineHeight);
  });
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";

  words.forEach((word) => {
    const nextLine = line ? `${line} ${word}` : word;
    if (context.measureText(nextLine).width <= maxWidth || !line) {
      line = nextLine;
      return;
    }

    lines.push(line);
    line = word;
  });

  if (line) {
    lines.push(line);
  }

  return lines;
}

function pickColor(id: string) {
  return paperColors[hashString(id) % paperColors.length];
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash);
}
