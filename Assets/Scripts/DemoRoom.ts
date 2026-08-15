/**
 * DeskOS — preview-only set dressing.
 *
 * A room built from Home Pack furniture, sized so that the surface DeskOS
 * simulates in Lens Studio Preview lands exactly on a desk top. Purely
 * scenery: nothing here is read by the Lens, and nothing in the Lens reads it.
 *
 * Why it exists: DeskOS places its tray on a real horizontal surface. On
 * hardware that surface is your actual desk. In Preview there is no hardware,
 * so DeskOSSurfacePlacer substitutes a virtual plane EDITOR_DESK_DROP_CM below
 * the camera — which works, but films against an empty void. The room gives
 * that plane something to be.
 *
 * Why it turns itself off: on Specs the real room is the room. A fake one
 * drawn on top of it would be a solid wall floating in the user's living
 * space. Shipping that by accident is a one-checkbox mistake, so the default
 * is to make it impossible rather than to remember.
 */

/**
 * Height of the seated eye above the floor (cm) — the geometry under this
 * object is authored around an eye at its local origin, so this is the number
 * that made the desk top land at exactly -45.3.
 */
const EYE_HEIGHT_CM = 113.6

/** Per-frame movement below which the camera counts as standing still (cm). */
const SETTLE_EPSILON_CM = 0.5

/** Consecutive still frames required before the pose is believed. */
const SETTLE_FRAMES = 3

/**
 * Render order for every visual in the set.
 *
 * The room is a backdrop and must never contend with the Lens for pixels. It
 * did: the room's opaque geometry was winning against the tray's labels, icons
 * and thumbnails, while UIKit's card faces — which ignore depth — survived.
 * That asymmetry made a whole-panel occlusion problem look like a text bug.
 *
 * A negative order puts the entire set in the queue ahead of anything the Lens
 * draws, so the question of who wins never arises.
 */
const ROOM_RENDER_ORDER = -10

/** Never anchor earlier than this — frame 1 is always the untracked pose. */
const SETTLE_MIN_S = 0.3

/** Anchor regardless after this, so a restless camera still gets a room. */
const SETTLE_MAX_S = 2.0

@component
export class DemoRoom extends BaseScriptComponent {
  @input
  @hint("Draw the room on real hardware too. Leave OFF unless you are debugging the set — on Specs this geometry would occlude the real world.")
  showOnDevice: boolean = false

  @input
  @hint("The Lens camera. The room anchors itself around wherever this is on the first frame.")
  camera: Camera

  private anchored = false
  private previous: vec3 | null = null
  private stillFrames = 0
  private wasEnabled: boolean[] = []
  private elapsed = 0

  onAwake(): void {
    // isEditor() is the right test here, unlike in the networking and capture
    // paths where it was hiding capability that Preview actually had. This is
    // not a capability question: the room is a stand-in for reality, and on
    // device reality is already present.
    const wanted = global.deviceInfoSystem.isEditor() || this.showOnDevice
    if (!wanted) {
      this.sceneObject.enabled = false
      print("[DemoRoom] Not in the editor — preview set hidden.")
      return
    }
    // Hidden until the pose is known. Showing it first and moving it after
    // would put a room on screen in the wrong place for a beat, which is the
    // one thing a set is not allowed to do.
    this.showContent(false)
    this.createEvent("UpdateEvent").bind(() => this.tick())
  }

  /**
   * Wait for the camera pose to settle, then move the set around it, once.
   *
   * The room cannot live at a fixed world position: Lens Studio's interactive
   * preview starts the camera wherever it was last driven. But it cannot be
   * anchored on frame one either, which is what the first version did and got
   * wrong. World tracking reports (0, 150, 0) before the preview applies its
   * own pose — a standing eye height above the tracking origin — and the
   * settled pose in this preview is y = 0. Anchoring to the first reading put
   * the floor 36 cm above the viewer's eye, under a room they could not reach
   * because preview height is not something you can drive.
   *
   * So: believe the pose only once it stops changing. Cap the wait, because a
   * camera being moved by hand never goes still and a room that never appears
   * is worse than one anchored mid-motion.
   */
  private tick(): void {
    if (this.anchored) return
    if (this.camera === null || this.camera === undefined) {
      this.anchored = true
      this.showContent(true)
      this.pushToBackground()
      print("[DemoRoom] No camera wired — set left at the scene origin.")
      return
    }

    const at = this.camera.getTransform().getWorldPosition()
    this.elapsed += getDeltaTime()

    const moved = this.previous === null ? Number.MAX_VALUE : at.distance(this.previous)
    this.previous = at
    this.stillFrames = moved < SETTLE_EPSILON_CM ? this.stillFrames + 1 : 0

    const settled = this.stillFrames >= SETTLE_FRAMES && this.elapsed >= SETTLE_MIN_S
    if (!settled && this.elapsed < SETTLE_MAX_S) return

    this.anchored = true

    // Yaw only. Inheriting the camera's pitch or roll would tilt the floor.
    // -Z is forward in this runtime, so the room's own -Z has to be turned to
    // match the camera's, which is what atan2 of the negated forward gives.
    const forward = this.camera.getTransform().getWorldRotation().multiplyVec3(new vec3(0, 0, -1))
    const yaw = Math.atan2(-forward.x, -forward.z)

    const me = this.sceneObject.getTransform()
    me.setWorldPosition(at)
    me.setWorldRotation(quat.angleAxis(yaw, vec3.up()))
    this.showContent(true)
    this.pushToBackground()

    print(
      "[DemoRoom] Set anchored at (" +
        at.x.toFixed(1) + ", " + at.y.toFixed(1) + ", " + at.z.toFixed(1) +
        ") after " + this.elapsed.toFixed(2) + "s" +
        (settled ? "" : " (cap reached, camera still moving)") +
        " — floor " + EYE_HEIGHT_CM + " cm below the eye."
    )
  }

  /** Put every visual in the set behind everything the Lens draws. */
  private pushToBackground(): void {
    const meshes = this.sceneObject.getComponentsInDescendants("RenderMeshVisual", false, true)
    for (const mesh of meshes) mesh.renderOrder = ROOM_RENDER_ORDER
    const texts = this.sceneObject.getComponentsInDescendants("Text", false, true)
    for (const text of texts) text.renderOrder = ROOM_RENDER_ORDER
    print(
      "[DemoRoom] " + meshes.length + " meshes and " + texts.length +
        " labels pushed to render order " + ROOM_RENDER_ORDER + "."
    )
  }

  /**
   * Show or hide everything under the root without disabling this script.
   *
   * Only children that were enabled to begin with are restored. Blanket-enabling
   * them turned this into a switch that silently overrode the Inspector: a prop
   * disabled by hand came back on every run, which is a confusing thing for set
   * dressing to do to you.
   */
  private showContent(visible: boolean): void {
    const root = this.sceneObject
    for (let i = 0; i < root.getChildrenCount(); i++) {
      const child = root.getChild(i)
      if (!visible) {
        this.wasEnabled.push(child.enabled)
        child.enabled = false
      } else if (i < this.wasEnabled.length) {
        child.enabled = this.wasEnabled[i]
      }
    }
  }
}
