import {MAX_PLACE_DISTANCE_CM, MIN_PLACE_DISTANCE_CM, MIN_SURFACE_NORMAL_DOT} from "./DeskOSConfig"

/**
 * DeskOS — WorldQuery surface hit testing.
 *
 * Plain TypeScript (no @component). Owns the HitTestSession lifecycle and the
 * horizontal-surface filter, so DeskOS.ts only deals with "is there a valid
 * surface under the pointer right now, and where".
 *
 * WorldQuery updates at roughly 5 Hz and returns null whenever the ray leaves
 * the camera frustum (the depth map only covers what the device can see), so
 * callers must tolerate gaps rather than treating a null as "no surface here".
 */

const WorldQueryModule = require("LensStudio:WorldQueryModule") as WorldQueryModule

/** Why a hit was rejected — drives the reticle state and the hint copy. */
export enum SurfaceReject {
  None = "none",
  NoHit = "no_hit",
  NotHorizontal = "not_horizontal",
  /** Level, but the user is underneath it — a ceiling or the underside of a shelf. */
  FacingAway = "facing_away",
  TooClose = "too_close",
  TooFar = "too_far"
}

/**
 * The part of a surface hit this class actually reads.
 *
 * Both WorldQueryHitTestResult (device) and RayCastHit (editor mock) satisfy
 * this shape, which is what lets a single classify() judge both.
 */
interface SurfaceHit {
  position: vec3
  normal: vec3
}

export interface SurfaceSample {
  /** True only when every acceptance test passed. */
  valid: boolean
  reject: SurfaceReject
  position: vec3 | null
  /** Unit surface normal, forced to point up-ish when valid. */
  normal: vec3 | null
  /** dot(normal, worldUp) — 1.0 is perfectly level. */
  levelness: number
}

const REJECTED: SurfaceSample = {
  valid: false,
  reject: SurfaceReject.NoHit,
  position: null,
  normal: null,
  levelness: 0
}

/**
 * Height of the simulated desk below eye level, used ONLY by the editor mock
 * (see simulate()). Roughly a seated eye-to-desktop drop.
 */
const EDITOR_DESK_DROP_CM = 45

export class DeskOSSurfacePlacer {
  private session: HitTestSession
  private running = false

  /**
   * WorldQuery is @wearableOnly — in Lens Studio Preview it never returns a hit,
   * so without a mock the Lens is undemonstrable off-device. When running in the
   * editor we substitute a flat virtual desk at a fixed drop below the camera.
   * Device behaviour is untouched.
   */
  readonly isEditorMock: boolean = global.deviceInfoSystem.isEditor()

  /** Most recent sample. hitTest is async, so this lags the ray by a frame or so. */
  private latest: SurfaceSample = REJECTED

  /** Guards against stacking hit tests faster than WorldQuery can answer them. */
  private inFlight = false

  /**
   * Physics probe used by the editor mock to hit the preview room for real.
   * Created on first use so a device build never allocates one.
   */
  private geometryProbe: Probe | null = null

  constructor(smoothing: boolean = true) {
    const options = HitTestSessionOptions.create()
    // Double-exponential filter over successive results — without this the
    // reticle jitters badly on a real desk.
    options.filter = smoothing
    this.session = WorldQueryModule.createHitTestSessionWithOptions(options)
  }

  /** Depth computation only runs while a session is started. */
  start(): void {
    if (this.running) return
    this.session.start()
    this.running = true
  }

  stop(): void {
    if (!this.running) return
    this.session.stop()
    this.running = false
    this.latest = REJECTED
    this.inFlight = false
  }

  getLatest(): SurfaceSample {
    return this.latest
  }

  /**
   * Issue a hit test along the given ray. The result lands in `getLatest()`
   * asynchronously — call this once per frame and read `getLatest()` for
   * whatever the depth system has most recently confirmed.
   */
  probe(rayStart: vec3, rayEnd: vec3, cameraPos: vec3): void {
    if (!this.running) return

    if (this.isEditorMock) {
      this.latest = this.simulate(rayStart, rayEnd, cameraPos)
      return
    }

    if (this.inFlight) return
    this.inFlight = true

    this.session.hitTest(rayStart, rayEnd, (result: WorldQueryHitTestResult | null) => {
      this.inFlight = false
      this.latest = this.classify(result, cameraPos)
    })
  }

  /**
   * Editor-only stand-in for WorldQuery.
   *
   * Casts against the actual colliders in the scene, so the DemoRoom's desk,
   * side table, cabinet and floor are all real targets and aiming decides
   * where the tray lands. Falls back to a flat virtual desk at a fixed drop
   * when there is nothing to hit, so a bare scene is still demonstrable.
   *
   * Either way the result goes through the SAME classify() the device path
   * uses, so what you exercise in Preview is the real state machine.
   */
  private simulate(rayStart: vec3, rayEnd: vec3, cameraPos: vec3): SurfaceSample {
    if (this.geometryProbe === null) this.geometryProbe = Physics.createGlobalProbe()

    const hits = this.geometryProbe.rayCastAllSync(rayStart, rayEnd)
    if (hits !== null && hits.length > 0) {
      // Hits come back nearest-first, but the nearest is not what we want: the
      // placement hint card carries an InteractionPlane collider and is parked
      // in the gaze path, so stopping at hit zero reported "not a flat surface"
      // no matter where the user aimed. Take the first surface along the ray
      // that a desk could actually go on.
      for (let i = 0; i < hits.length; i++) {
        const candidate = this.classify(hits[i], cameraPos)
        if (candidate.valid) return candidate
      }
      // Nothing placeable along the ray. Report why the nearest one failed, so
      // aiming at a wall still says "not a flat surface" rather than "no hit".
      return this.classify(hits[0], cameraPos)
    }

    const planeY = cameraPos.y - EDITOR_DESK_DROP_CM
    const dir = rayEnd.sub(rayStart)
    if (Math.abs(dir.y) < 1e-5) return REJECTED

    const t = (planeY - rayStart.y) / dir.y
    if (t < 0 || t > 1) return REJECTED // plane is behind the ray or beyond its end

    const position = rayStart.add(dir.uniformScale(t))
    const normal = new vec3(0, 1, 0)
    const distance = position.sub(cameraPos).length
    if (distance < MIN_PLACE_DISTANCE_CM) {
      return {valid: false, reject: SurfaceReject.TooClose, position, normal, levelness: 1}
    }
    if (distance > MAX_PLACE_DISTANCE_CM) {
      return {valid: false, reject: SurfaceReject.TooFar, position, normal, levelness: 1}
    }
    return {valid: true, reject: SurfaceReject.None, position, normal, levelness: 1}
  }

  /** Apply the horizontal-surface and range filters to a raw WorldQuery result. */
  private classify(result: SurfaceHit | null, cameraPos: vec3): SurfaceSample {
    if (result === null || isNull(result)) return REJECTED

    const position = result.position
    const rawNormal = result.normal.normalize()

    // A depth-derived normal can come back facing either way along the surface.
    // Flip it so it always points up out of the surface, THEN test levelness —
    // that keeps a table readable regardless of which side the normal faced.
    // Flipping alone would also let a CEILING through — its normal points down
    // at the user, so |dot(normal, up)| is still ~1 — which is what the
    // support-side test further down exists to reject.
    const worldUp = new vec3(0, 1, 0)
    const levelness = rawNormal.dot(worldUp)
    const normal = levelness >= 0 ? rawNormal : rawNormal.uniformScale(-1)
    const absLevelness = Math.abs(levelness)

    const distance = position.sub(cameraPos).length
    if (distance < MIN_PLACE_DISTANCE_CM) {
      return {valid: false, reject: SurfaceReject.TooClose, position, normal, levelness: absLevelness}
    }
    if (distance > MAX_PLACE_DISTANCE_CM) {
      return {valid: false, reject: SurfaceReject.TooFar, position, normal, levelness: absLevelness}
    }

    // The actual "is this a table/desk/floor" test: the surface must be within
    // MAX_SURFACE_TILT_DEG of level. Walls sit near 0 and are rejected.
    if (absLevelness < MIN_SURFACE_NORMAL_DOT) {
      return {
        valid: false,
        reject: SurfaceReject.NotHorizontal,
        position,
        normal,
        levelness: absLevelness
      }
    }

    // Levelness alone cannot separate a desk from a ceiling or the underside of
    // a shelf — all three are level. Require the user to be on the side the
    // (up-ward) normal points toward, i.e. above the surface they place on.
    // A ceiling puts the camera on the far side and is rejected here.
    if (normal.dot(cameraPos.sub(position)) <= 0) {
      return {
        valid: false,
        reject: SurfaceReject.FacingAway,
        position,
        normal,
        levelness: absLevelness
      }
    }

    return {valid: true, reject: SurfaceReject.None, position, normal, levelness: absLevelness}
  }
}
