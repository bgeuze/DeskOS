/**
 * DeskOS — shared tuning constants and spatial math.
 *
 * Plain TypeScript (no @component): imported by DeskOS.ts and
 * DeskOSSurfacePlacer.ts. Keeping the numbers and the basis math in one place
 * makes the placement behaviour tunable without touching the state machine.
 */

// ── Surface acceptance ───────────────────────────────────────────────────────

/**
 * How far a surface may tilt from level and still count as "horizontal".
 * A real desk is never perfectly flat, and the depth-derived normal is noisy,
 * so we allow a generous cone. Walls (~90 deg) and ceilings (normal pointing
 * down) are rejected.
 */
export const MAX_SURFACE_TILT_DEG = 25

/** cos(MAX_SURFACE_TILT_DEG) — compared against dot(normal, worldUp). */
export const MIN_SURFACE_NORMAL_DOT = Math.cos((MAX_SURFACE_TILT_DEG * Math.PI) / 180)

/** Smoothing factor for the reticle's tracked pose (0..1 per frame, higher = snappier). */
export const RETICLE_FOLLOW_SPEED = 12

/** Hit tests are only accepted within this range of the user (cm). */
export const MIN_PLACE_DISTANCE_CM = 25
export const MAX_PLACE_DISTANCE_CM = 400

// ── Desk layout, expressed in the DeskAnchor frame ───────────────────────────
//
// DeskAnchor is a world-anchored frame sitting ON the detected surface:
//   +Y = surface normal (up off the table)
//   -Z = away from the user (Lens forward convention)
//   +X = to the user's right
//
// The UI panel is authored in ordinary panel-local XY, so it is parented with a
// -90 deg X rotation that maps panel +Z (its normal) onto anchor +Y.

/** How far the tray floats above the physical surface (cm) — reads as "resting on". */
export const TRAY_SURFACE_LIFT = 0.35

/** Desk-anchor-local position of the drag handle, on the near edge of the tray. */
export const HANDLE_ANCHOR_POS = new vec3(0, 0, 16.0)

/**
 * DeskHandle.glb AABB, from /build-mesh: 3.4 x 2.4 x 3.4 cm,
 * centre offset (0, 1.2, 0), grounded (min-Y = 0).
 */
export const HANDLE_AABB_CM = new vec3(3.4, 2.4, 3.4)
export const HANDLE_CENTER_OFFSET_CM = new vec3(0, 1.2, 0)

/**
 * Collider box for the handle, deliberately LARGER than the 3.4 cm visual.
 * SIK guidance is a 4 cm minimum / 6 cm recommended interactive target, and a
 * grab affordance that is hard to hit is worse than one that is slightly
 * generous. Lives on the unit-scale wrapper, so these are true cm.
 */
export const HANDLE_COLLIDER_CM = new vec3(6, 4, 6)

/** Distance in front of the camera where the placement hint card is parked (cm). */
export const HINT_DISTANCE_CM = 90

/**
 * Vertical offset of the hint card above the gaze centre (cm at HINT_DISTANCE_CM).
 *
 * Without this the card sits exactly on the gaze ray — directly between the user
 * and the surface the card is telling them to aim at — so it occludes its own
 * target and the reticle. Lifting it ~12 deg above centre keeps the aim point clear.
 */
export const HINT_VERTICAL_OFFSET_CM = 20

/** How quickly the hint card chases the user's gaze (0..1 per frame, scaled by dt). */
export const HINT_FOLLOW_SPEED = 6

// ── Spatial math ─────────────────────────────────────────────────────────────

/**
 * Build a rotation from an orthonormal right-handed basis given as the world
 * directions of the object's local +X, +Y and +Z axes.
 *
 * Implemented via Shepperd's method rather than `quat.lookAt`, because
 * `lookAt`'s forward-axis convention is ambiguous across Lens Studio versions
 * and getting it wrong silently mis-orients everything downstream. This is
 * fully determined by the inputs.
 */
export function rotationFromBasis(x: vec3, y: vec3, z: vec3): quat {
  // Column-major: m[row][col], columns are the basis vectors.
  const m00 = x.x,
    m01 = y.x,
    m02 = z.x
  const m10 = x.y,
    m11 = y.y,
    m12 = z.y
  const m20 = x.z,
    m21 = y.z,
    m22 = z.z

  const trace = m00 + m11 + m22
  let w: number, qx: number, qy: number, qz: number

  if (trace > 0) {
    const s = Math.sqrt(trace + 1.0) * 2
    w = 0.25 * s
    qx = (m21 - m12) / s
    qy = (m02 - m20) / s
    qz = (m10 - m01) / s
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2
    w = (m21 - m12) / s
    qx = 0.25 * s
    qy = (m01 + m10) / s
    qz = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2
    w = (m02 - m20) / s
    qx = (m01 + m10) / s
    qy = 0.25 * s
    qz = (m12 + m21) / s
  } else {
    const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2
    w = (m10 - m01) / s
    qx = (m02 + m20) / s
    qy = (m12 + m21) / s
    qz = 0.25 * s
  }

  // NOTE: quat.normalize() is in-place and returns void — do not chain it.
  const q = new quat(w, qx, qy, qz)
  q.normalize()
  return q
}

/** Component of `v` that lies in the plane with normal `n` (n must be unit). */
export function projectOntoPlane(v: vec3, n: vec3): vec3 {
  return v.sub(n.uniformScale(v.dot(n)))
}

/**
 * The DeskAnchor rotation for a surface hit: +Y along the surface normal,
 * -Z pointing away from the user along the surface.
 */
export function deskAnchorRotation(surfaceNormal: vec3, cameraPos: vec3, hitPos: vec3): quat {
  const up = surfaceNormal.normalize()

  // Direction the user is facing, flattened into the surface plane.
  let away = projectOntoPlane(hitPos.sub(cameraPos), up)
  if (away.length < 0.001) {
    // User is directly above the hit point — fall back to any stable tangent.
    away = projectOntoPlane(new vec3(0, 0, -1), up)
    if (away.length < 0.001) away = projectOntoPlane(new vec3(1, 0, 0), up)
  }
  away = away.normalize()

  const zAxis = away.uniformScale(-1) // Lens forward is -Z, so -Z points away
  const xAxis = up.cross(zAxis).normalize()
  const yAxis = zAxis.cross(xAxis).normalize()
  return rotationFromBasis(xAxis, yAxis, zAxis)
}

/**
 * Rotation for the placement reticle. Its geometry lies in the local XZ plane
 * with a +Y normal (see PlacementReticle.ts), so local +Y goes along the
 * surface normal.
 */
export function reticleRotation(surfaceNormal: vec3, cameraPos: vec3, hitPos: vec3): quat {
  const up = surfaceNormal.normalize()
  let away = projectOntoPlane(hitPos.sub(cameraPos), up)
  if (away.length < 0.001) {
    away = projectOntoPlane(new vec3(0, 0, -1), up)
    if (away.length < 0.001) away = projectOntoPlane(new vec3(1, 0, 0), up)
  }
  away = away.normalize()

  // Right-handed basis with local +Y on the surface normal: Z = X cross Y.
  const yAxis = up
  const zAxis = away.cross(yAxis).normalize()
  const xAxis = yAxis.cross(zAxis).normalize()
  return rotationFromBasis(xAxis, yAxis, zAxis)
}

/** Rotation that makes a panel's +Z normal point at `cameraPos` from `panelPos`. */
export function billboardRotation(panelPos: vec3, cameraPos: vec3): quat {
  let zAxis = cameraPos.sub(panelPos)
  if (zAxis.length < 0.001) zAxis = new vec3(0, 0, 1)
  zAxis = zAxis.normalize()

  const worldUp = new vec3(0, 1, 0)
  let xAxis = worldUp.cross(zAxis)
  if (xAxis.length < 0.001) {
    // Looking straight up/down — pick any perpendicular.
    xAxis = new vec3(1, 0, 0).cross(zAxis)
  }
  xAxis = xAxis.normalize()
  const yAxis = zAxis.cross(xAxis).normalize()
  return rotationFromBasis(xAxis, yAxis, zAxis)
}
