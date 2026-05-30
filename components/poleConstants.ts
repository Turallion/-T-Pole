export const POLE_RADIUS = 1;
export const POLE_HEIGHT = 54;
export const POSTER_SURFACE_OFFSET = 0.0025;

export function cylindricalPosition(angle: number, y: number, radius = POLE_RADIUS) {
  return [Math.sin(angle) * radius, y, Math.cos(angle) * radius] as const;
}
