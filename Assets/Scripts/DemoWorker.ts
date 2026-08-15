/**
 * DeskOS — the avatar at the desk.
 *
 * Poses the user's Bitmoji into a seated working posture and keeps it lightly
 * animated, so the preview set has somebody in it. Scenery only: like DemoRoom
 * it exists for the camera, and it disables itself off-editor.
 *
 * Why pose it by hand rather than play a clip: the Lens API exposes
 * Bitmoji3DOptions.AnimationParams but nothing to name an animation with — that
 * catalogue lives in Lens Studio's Bitmoji Suite, not in script. What the
 * component does give us is `mixamoAnimation`, which re-targets the avatar onto
 * a Mixamo-style rig. That means standard joint names (Hips, Spine1, LeftArm,
 * LeftForeArm...), which is enough to build the pose directly.
 *
 * Every rotation is applied as an offset ON TOP of the joint's bind rotation,
 * never as a replacement. Replacing it throws away the rest orientation the rig
 * was skinned against and the avatar folds inside out.
 */

/** Joint names come from the Mixamo re-target, confirmed against the loaded rig. */
const J_HIPS = "Hips"
const J_SPINE1 = "Spine1"
const J_NECK = "Neck"
const J_L_UPLEG = "LeftUpLeg"
const J_R_UPLEG = "RightUpLeg"
const J_L_LEG = "LeftLeg"
const J_R_LEG = "RightLeg"
const J_L_ARM = "LeftArm"
const J_R_ARM = "RightArm"
const J_L_FOREARM = "LeftForeArm"
const J_R_FOREARM = "RightForeArm"

const DEG = Math.PI / 180

/** Frames to wait after the rig appears before its transforms can be trusted. */
const RIG_SETTLE_FRAMES = 20


interface PosedJoint {
  object: SceneObject
  bind: quat
}

@component
export class DemoWorker extends BaseScriptComponent {
  @input
  @hint("Object carrying the Bitmoji3D component. The rig is searched for underneath it.")
  bitmoji: SceneObject

  @input
  @hint("Height of the chair seat above the floor, in cm. The avatar is dropped so its hips land here.")
  seatHeightCm: number = 46

  @input
  @hint("Thigh rotation in degrees. Negative swings the knees forward.")
  thighDeg: number = -82

  @input
  @hint("Knee bend in degrees.")
  kneeDeg: number = 80

  @input
  @hint("Upper arm rotation in degrees. Negative brings the elbows down and forward.")
  upperArmDeg: number = -62

  @input
  @hint("Forearm bend in degrees, reaching towards the keyboard.")
  foreArmDeg: number = 48

  @input
  @hint("Typing strokes per second.")
  typingSpeed: number = 6.5

  @input
  @hint("How far the forearms travel per stroke, in degrees.")
  typingDeg: number = 5

  private forearms: PosedJoint[] = []
  private spine: PosedJoint | null = null
  private neck: PosedJoint | null = null
  private elapsed = 0
  private posed = false
  private settleFrames = 0

  onAwake(): void {
    if (!global.deviceInfoSystem.isEditor()) {
      this.sceneObject.enabled = false
      return
    }
    // The avatar arrives over the network, so the rig does not exist at start.
    // Poll rather than guess a delay.
    this.createEvent("UpdateEvent").bind(() => this.tick())
  }

  private tick(): void {
    if (!this.posed) {
      if (this.bitmoji === null || this.bitmoji === undefined) return
      const hips = this.find(this.bitmoji, J_HIPS)
      if (hips === null) return

      // Let the rig settle before touching it. The joint objects exist a frame
      // or two before their world transforms resolve.
      //
      // Scale is NOT set here. Bitmoji 3D loads at roughly 1/100th of Lens
      // Studio's centimetre world, and scaling the holder after the rig was
      // built drove the avatar's own geometry to kilometre-scale bounds — the
      // rig carries _SSC (segment scale compensate) nodes that cancel parent
      // scale, and changing that scale underneath them does not survive. The
      // holder is scaled in the scene instead, before the avatar arrives.
      if (this.settleFrames < RIG_SETTLE_FRAMES) {
        this.settleFrames++
        return
      }

      this.pose(hips)
      this.posed = true
      return
    }

    this.elapsed += getDeltaTime()

    // Alternating hands: half a cycle apart reads as typing rather than as
    // both arms pumping in unison, which reads as a workout.
    for (let i = 0; i < this.forearms.length; i++) {
      const phase = this.elapsed * this.typingSpeed * 2 * Math.PI + i * Math.PI
      const wobble = Math.sin(phase) * this.typingDeg
      this.rotate(this.forearms[i], this.foreArmDeg + wobble)
    }

    // A slow breath through the spine and an occasional glance keep the pose
    // from reading as a mannequin between keystrokes.
    if (this.spine !== null) this.rotate(this.spine, Math.sin(this.elapsed * 1.4) * 1.4)
    if (this.neck !== null) {
      this.neck.object
        .getTransform()
        .setLocalRotation(
          this.neck.bind.multiply(quat.angleAxis(Math.sin(this.elapsed * 0.45) * 7 * DEG, vec3.up()))
        )
    }
  }

  /** Fold the standing avatar into a chair and reach for the keyboard. */
  private pose(hips: SceneObject): void {
    const root = this.bitmoji.getTransform()

    // Measure the hip height instead of assuming it — Bitmoji bodies differ,
    // and a hard-coded drop would leave one avatar hovering and another sunk
    // into the seat.
    const hipLift = hips.getTransform().getWorldPosition().y - root.getWorldPosition().y
    const drop = hipLift - this.seatHeightCm
    const local = root.getLocalPosition()
    root.setLocalPosition(new vec3(local.x, local.y - drop, local.z))
    print("[DemoWorker] Seated: hips at " + hipLift.toFixed(1) + " cm, dropped " + drop.toFixed(1) + " cm.")

    this.bend(hips, J_L_UPLEG, this.thighDeg)
    this.bend(hips, J_R_UPLEG, this.thighDeg)
    this.bend(hips, J_L_LEG, this.kneeDeg)
    this.bend(hips, J_R_LEG, this.kneeDeg)
    this.bend(hips, J_L_ARM, this.upperArmDeg)
    this.bend(hips, J_R_ARM, this.upperArmDeg)

    const spine = this.grab(hips, J_SPINE1)
    if (spine !== null) this.spine = spine
    const neck = this.grab(hips, J_NECK)
    if (neck !== null) this.neck = neck

    const left = this.grab(hips, J_L_FOREARM)
    const right = this.grab(hips, J_R_FOREARM)
    if (left !== null) this.forearms.push(left)
    if (right !== null) this.forearms.push(right)
    if (this.forearms.length === 0) {
      print("[DemoWorker] No forearm joints found — pose is static.")
    }
  }

  private bend(from: SceneObject, name: string, degrees: number): void {
    const joint = this.grab(from, name)
    if (joint === null) {
      print("[DemoWorker] Joint not found: " + name)
      return
    }
    this.rotate(joint, degrees)
  }

  /** Offset from the bind pose, about the joint's own X axis. */
  private rotate(joint: PosedJoint, degrees: number): void {
    joint.object
      .getTransform()
      .setLocalRotation(joint.bind.multiply(quat.angleAxis(degrees * DEG, vec3.right())))
  }

  private grab(from: SceneObject, name: string): PosedJoint | null {
    const object = this.find(from, name)
    if (object === null) return null
    return {object, bind: object.getTransform().getLocalRotation()}
  }

  private find(root: SceneObject, name: string): SceneObject | null {
    if (root.name === name) return root
    for (let i = 0; i < root.getChildrenCount(); i++) {
      const hit = this.find(root.getChild(i), name)
      if (hit !== null) return hit
    }
    return null
  }
}
