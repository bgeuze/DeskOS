import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import {
  Interactor,
  InteractorInputType,
  InteractorTriggerType
} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractableManipulation} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"

import {DeskOSUI} from "./DeskOSUI"
import {DeskOSHintUI} from "./DeskOSHintUI"
import {PlacementReticle} from "./PlacementReticle"
import {DeskOSAudio} from "./DeskOSAudio"
import {DeskOSSurfacePlacer, SurfaceReject, SurfaceSample} from "./DeskOSSurfacePlacer"
import {CloudDesk, DeskOSCloud} from "./DeskOSCloud"
import {DeskOSCapture} from "./DeskOSCapture"
import {DeskOSBrain} from "./DeskOSBrain"
import {ContentKind} from "./DeskOSTypes"
import {
  billboardRotation,
  deskAnchorRotation,
  HANDLE_AABB_CM,
  HANDLE_ANCHOR_POS,
  HANDLE_CENTER_OFFSET_CM,
  HANDLE_COLLIDER_CM,
  HINT_DISTANCE_CM,
  HINT_FOLLOW_SPEED,
  HINT_VERTICAL_OFFSET_CM,
  MAX_PLACE_DISTANCE_CM,
  projectOntoPlane,
  reticleRotation,
  RETICLE_FOLLOW_SPEED,
  TRAY_SURFACE_LIFT
} from "./DeskOSConfig"

const handlePrefab = requireAsset("../GeneratedMeshes/DeskHandle.glb") as ObjectPrefab

const remoteMediaModule = require("LensStudio:RemoteMediaModule") as RemoteMediaModule
const internetModule = require("LensStudio:InternetModule") as InternetModule

enum DeskState {
  /** Looking for a surface. Hint + reticle visible, desk hidden. */
  Placing = "placing",
  /** Desk is anchored to a physical surface and interactive. */
  Placed = "placed"
}

/**
 * DeskOS — a spatial desktop anchored to a real horizontal surface.
 *
 * Responsibilities:
 *  - Run WorldQuery hit tests along the SIK targeting ray, filtered to
 *    horizontal surfaces (DeskOSSurfacePlacer).
 *  - On pinch-release over a valid surface, build a world-anchored DeskAnchor
 *    frame and park the UI + drag handle on it.
 *  - Keep the desk ON that surface forever after: the anchor is a scene-root
 *    object with a world pose, never parented to the camera, and every
 *    manipulation is re-projected onto the anchored plane.
 *  - Bridge the two UI modules (data in via setters, input out via Events).
 */
@component
export class DeskOS extends BaseScriptComponent {
  // Inspector toggle: flip ON to wireframe every collider/body in the generated
  // scene for hit-zone diagnosis. Takes effect on preview restart.
  @input
  debugColliders: boolean = false

  // Wired by the bootstrap to each panel's ScriptComponent. Typed as the UI
  // class directly — Lens Studio resolves the wired ScriptComponent to the
  // class instance at runtime, so no .getScript() and no cast.
  @input
  uiDesk!: DeskOSUI

  @input
  uiHint!: DeskOSHintUI

  @input
  reticle!: PlacementReticle

  /**
   * Microphone source for voice notes. Optional: a Microphone audio track asset
   * cannot be synthesised at runtime, so without one the Memo affordance
   * reports that it is unavailable instead of half-recording.
   */
  @input
  @allowUndefined
  micAudioTrack!: AudioTrackAsset

  // Resolved in onAwake, NOT as a field initializer: field initializers run at
  // component construction, which can precede the camera being resolvable.
  private camera!: WorldCameraFinderProvider
  private placer: DeskOSSurfacePlacer | null = null
  private cloud: DeskOSCloud = new DeskOSCloud()
  private cloudDesk: CloudDesk | null = null
  /** Downloaded photos, kept so opening a viewer does not re-fetch. */
  private textureCache: Record<string, Texture> = {}
  private capture: DeskOSCapture = new DeskOSCapture(this.cloud)
  private brain: DeskOSBrain = new DeskOSBrain()
  /** One capture at a time — a second pinch mid-flight would race the first. */
  private capturing = false
  /** Distinguishes concurrent-ish captures; the display name is not stable. */
  private captureSeq = 0
  /** Captures land in whichever folder is open, else the first one. */
  private captureTarget = "photos"
  private audio: DeskOSAudio | null = null

  private state: DeskState = DeskState.Placing

  /** World-anchored frame sitting on the detected surface. Scene root, never camera-parented. */
  private deskAnchor: SceneObject | null = null
  private handleWrapper: SceneObject | null = null
  private manipulation: InteractableManipulation | null = null

  /** The plane the desk was anchored to — manipulation is re-projected onto it. */
  private anchorOrigin: vec3 = vec3.zero()
  private anchorNormal: vec3 = new vec3(0, 1, 0)
  private anchorRotation: quat = quat.quatIdentity()

  private reticleVisible = false
  private hadValidSurface = false
  private isManipulating = false
  private hintPos: vec3 | null = null

  onAwake(): void {
    this.camera = WorldCameraFinderProvider.getInstance()
    this.audio = new DeskOSAudio(this.sceneObject)
    this.placer = new DeskOSSurfacePlacer(true)

    // Panels start in their placement-mode configuration. setPanelVisible is
    // deferred internally until OnStart, so this is safe here.
    this.uiDesk.setPanelVisible(false)
    this.uiHint.setPanelVisible(true)

    // SIK / WorldQuery work must not begin until OnStart — SIK singletons and
    // interactors are not ready during onAwake.
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart(): void {
    this.reticle.setVisible(false)
    this.reticle.setSearching()

    this.placer?.start()

    // UI event bus — data flows out of the panels as typed events.
    this.uiDesk.onFolderSelected.add((id: string) => this.onFolderSelected(id))
    this.uiDesk.onCapturePhoto.add(() => this.onCapturePhoto())
    this.uiDesk.onToggleRecord.add(() => this.onToggleRecord())
    this.uiDesk.onFolderHoverEnter.add(() => this.audio?.playCardHover())
    this.uiDesk.onMoveRequested.add(() => this.enterPlacingMode())

    // Picking a folder up and putting it down are distinct, audible events —
    // the visual lift/shadow is reinforced by sound and a status line.
    this.uiDesk.onFolderGrabbed.add((id: string) => {
      this.audio?.playCardHover()
      this.uiDesk.setStatus(`Moving ${this.uiDesk.getFolderTitle(id)}`)
    })
    this.uiDesk.onFileHover.add(() => this.audio?.playCardHover())
    this.uiDesk.onFileRegrouped.add((move: string) => {
      this.audio?.playSurfaceLock()
      this.uiDesk.setStatus(`Moved ${move}`)
    })
    this.uiDesk.onFileOpened.add((name: string) => {
      this.audio?.playCardSelect()
      this.uiDesk.setStatus(`Viewing ${name}`)
      this.onViewerOpened()
    })

    this.uiDesk.onFolderReleased.add((id: string) => {
      this.audio?.playCardSelect()
      this.uiDesk.setStatus(`${this.uiDesk.getFolderTitle(id)} placed`)
    })

    this.createEvent("UpdateEvent").bind(() => {
      this.onUpdate()
      // Microphone frames are only buffered while a recording is running.
      this.capture.pump()
    })
    // Manipulation constraint runs late so it corrects whatever SIK wrote this frame.
    this.createEvent("LateUpdateEvent").bind(() => this.constrainToSurface())

    if (this.debugColliders) {
      this.setColliderDebugAll(this.getSceneObject(), true)
    }

    // Fired and forgotten: the desk is fully usable on its built-in content, so
    // the network must never gate startup. Cloud data arrives when it arrives.
    this.loadCloud()

    // Started up front, not on demand. The stream needs a moment to deliver its
    // first frame, and asking for one at pinch time would make every capture
    // wait for that warm-up.
    this.capture.startCamera()
  }

  // ── Frame loop ────────────────────────────────────────────────────────────

  private onUpdate(): void {
    if (this.state === DeskState.Placing) {
      this.updatePlacing()
    }
  }

  private updatePlacing(): void {
    const dt = getDeltaTime()
    this.updateHintPose(dt)

    const interactor = this.getPlacementInteractor()
    const cameraPos = this.camera.getWorldPosition()

    // Prefer the interactor's own ray (hand targeting ray on device, mouse ray
    // in Preview). Fall back to the head gaze ray so the reticle still tracks
    // when no interactor is targeting yet — otherwise the user gets no feedback
    // at all until they happen to raise a hand.
    let rayStart: vec3 = cameraPos
    let rayEnd: vec3 = cameraPos.add(this.getGazeDirection().uniformScale(MAX_PLACE_DISTANCE_CM))
    if (interactor !== null && interactor.startPoint !== null && interactor.endPoint !== null) {
      rayStart = interactor.startPoint
      rayEnd = interactor.endPoint
    }
    this.placer?.probe(rayStart, rayEnd, cameraPos)

    const sample = this.placer?.getLatest() ?? null
    if (sample === null) return

    this.applySampleToReticle(sample, dt)
    this.applySampleToHint(sample)

    // Commit on pinch release over a valid surface. SIK tracks the edge for us.
    const released =
      interactor !== null &&
      interactor.previousTrigger !== InteractorTriggerType.None &&
      interactor.currentTrigger === InteractorTriggerType.None
    if (released && sample.valid && sample.position !== null && sample.normal !== null) {
      this.placeDesk(sample.position, sample.normal)
    }
  }

  private async loadCloud(): Promise<void> {
    const desk = await this.cloud.load()
    this.cloudDesk = desk
    if (desk === null) {
      print("[DeskOS] Cloud unavailable — running on sample content.")
      return
    }
    print(
      "[DeskOS] Cloud desk ready: " +
        desk.folders.length +
        " folders, " +
        desk.files.length +
        " files."
    )

    const result = this.uiDesk.applyCloudDesk(desk.folders, desk.files)
    print("[DeskOS] Seated " + result.seated + " of " + desk.files.length + " cloud files.")
    if (result.unseated.length > 0) {
      // Reported rather than dropped: the chip pool is fixed at scene start, so
      // a folder can run out of chips of the right kind.
      print("[DeskOS] No chip available for: " + result.unseated.join(", "))
    }
    this.uiDesk.setStatus("Synced " + result.seated + " files")

    for (const f of desk.files) {
      if (f.kind === "image" && f.storagePath !== null) {
        this.loadPhoto(f.name, f.storagePath)
      }
    }
  }

  /**
   * Look at something, pinch, and have it land filed.
   *
   * Two phases, because understanding takes about five seconds and a desk that
   * does nothing for five seconds after a pinch reads as broken. The card lands
   * immediately with the frame already on it; the name and the folder arrive a
   * beat later. The move to the chosen folder is the part worth watching.
   *
   * Each stage fails on its own terms: the frame is the capture, the
   * understanding is a nicety, the upload is durability. Losing the later ones
   * degrades the result but never discards what the user actually did.
   */
  private async onCapturePhoto(): Promise<void> {
    if (this.capturing) return
    this.capturing = true

    try {
      const frame = await this.capture.grabFrame()
      if (frame === null) {
        this.uiDesk.setStatus("Camera unavailable")
        return
      }

      const landing = this.currentFolderSlug()
      this.captureSeq++
      const token = "capture-" + this.captureSeq
      const placeholder = "Reading…"

      if (!this.uiDesk.seatCapture(landing, "image", placeholder, "", null, token)) {
        this.uiDesk.setStatus("No room on the desk")
        return
      }
      this.uiDesk.setFileTexture(placeholder, frame.texture)
      this.audio?.playCardSelect()
      this.uiDesk.setStatus("Reading it…")

      const seen = await this.brain.understand(frame.base64, this.uiDesk.folderChoices())
      const title = seen === null ? "Photo " + this.clock() : seen.title
      const meta = seen === null ? "JPG" : seen.meta
      const slug = seen === null ? landing : seen.folderSlug

      if (seen === null) {
        print("[DeskOS] No understanding — filing under a timestamp.")
      } else {
        print(
          "[DeskOS] Understood: '" + seen.title + "' -> " + seen.folderSlug +
            " — " + seen.rationale
        )
      }

      this.uiDesk.finishCapture(token, title, meta, null, slug)
      this.textureCache[title] = frame.texture
      this.uiDesk.setFileTexture(title, frame.texture)
      this.uiDesk.setStatus(seen === null ? title : title + " — " + seen.rationale)

      const stored = await this.cloud.uploadCapture(
        "image" as ContentKind,
        title,
        meta,
        slug,
        frame.bytes,
        "image/jpeg",
        "jpg"
      )
      if (stored === null) print("[DeskOS] " + title + " is on the desk but not in the cloud.")
    } catch (e) {
      print("[DeskOS] Capture failed: " + e)
      this.uiDesk.setStatus("Capture failed")
    } finally {
      this.capturing = false
    }
  }

  private clock(): string {
    const d = new Date()
    const two = (n: number): string => (n < 10 ? "0" : "") + n
    return two(d.getHours()) + ":" + two(d.getMinutes())
  }

  private titleCase(slug: string): string {
    return slug.length === 0 ? slug : slug.charAt(0).toUpperCase() + slug.slice(1)
  }

  private async onToggleRecord(): Promise<void> {
    if (this.capture.isRecording()) {
      this.uiDesk.setStatus("Saving memo…")
      const name = await this.capture.stopRecording(this.currentFolderSlug())
      this.uiDesk.setStatus(name === null ? "Memo failed" : name + " saved")
      if (name !== null) this.audio?.playCardSelect()
      return
    }
    const track = this.micAudioTrack === undefined ? null : this.micAudioTrack
    const started = this.capture.startRecording(track)
    this.uiDesk.setStatus(started ? "Recording — tap Memo to stop" : "Microphone unavailable")
  }

  /** Open folder wins, so a capture lands where the user is looking. */
  private currentFolderSlug(): string {
    const selected = this.uiDesk.getSelected()
    return selected === null ? this.captureTarget : selected.toLowerCase()
  }

  /** Fetch a photo and drop it into its chip thumbnail. */
  private async loadPhoto(name: string, storagePath: string): Promise<void> {
    const bytes = await this.cloud.download(storagePath)
    if (bytes === null) return
    const resource = DynamicResource.createWithBuffer(bytes)
    remoteMediaModule.loadResourceAsImageTexture(
      resource,
      (texture: Texture) => {
        this.textureCache[name] = texture
        this.uiDesk.setFileTexture(name, texture)
        print("[DeskOS] Photo ready: " + name)
      },
      (err: string) => print("[DeskOS] Photo failed for " + name + ": " + err)
    )
  }

  /**
   * Feed the freshly-opened viewer its real media.
   *
   * Photos come from the cache filled at sync time; audio is streamed from its
   * public URL on demand, since a track is only needed while it is playing.
   */
  private onViewerOpened(): void {
    const open = this.uiDesk.getOpenFile()
    print(
      "[DeskOS] viewerOpened " +
        (open === null
          ? "null"
          : open.name + " kind=" + open.kind + " path=" + open.storagePath)
    )
    if (open === null || open.storagePath === null) return

    if (open.kind === "image") {
      const cached = this.textureCache[open.name]
      if (cached !== undefined) this.uiDesk.setViewerTexture(cached)
      return
    }

    if (open.kind === "audio") {
      const url = this.cloud.publicUrl(open.storagePath)
      if (url === null) return
      const resource = internetModule.makeResourceFromUrl(url)
      remoteMediaModule.loadResourceAsAudioTrackAsset(
        resource,
        (track: AudioTrackAsset) => {
          this.uiDesk.playViewerAudio(track)
          print("[DeskOS] Playing " + open.name)
        },
        (err: string) => print("[DeskOS] Audio failed for " + open.name + ": " + err)
      )
    }
  }

  /** World-space direction the user is looking. Transform.forward is +Z, so negate. */
  private getGazeDirection(): vec3 {
    return this.camera.forward().uniformScale(-1).normalize()
  }

  /**
   * The interactor driving placement.
   *
   * Prefer one that is actively targeting (hand ray on device). Fall back to any
   * active interactor, because MouseInteractor.isTargeting() is only true while
   * the mouse is held — without the fallback we would lose the release edge at
   * exactly the moment the user commits in Preview.
   */
  private getPlacementInteractor(): Interactor | null {
    const targeting = SIK.InteractionManager.getTargetingInteractors()
    for (const candidate of targeting) {
      if (candidate.isActive()) return candidate
    }
    const all = SIK.InteractionManager.getInteractorsByType(InteractorInputType.All)
    for (const candidate of all) {
      if (candidate.isActive() && candidate.currentTrigger !== InteractorTriggerType.None) {
        return candidate
      }
    }
    for (const candidate of all) {
      if (candidate.isActive() && candidate.previousTrigger !== InteractorTriggerType.None) {
        return candidate
      }
    }
    return null
  }

  private applySampleToReticle(sample: SurfaceSample, dt: number): void {
    if (sample.position === null || sample.normal === null) {
      this.showReticle(false)
      this.hadValidSurface = false
      return
    }

    this.showReticle(true)

    const reticleObj = this.reticle.getSceneObject()
    const tr = reticleObj.getTransform()
    // Float the marker just off the surface so it never z-fights the real table.
    const target = sample.position.add(sample.normal.uniformScale(0.2))
    const k = Math.min(1, dt * RETICLE_FOLLOW_SPEED)
    tr.setWorldPosition(vec3.lerp(tr.getWorldPosition(), target, k))
    tr.setWorldRotation(
      reticleRotation(sample.normal, this.camera.getWorldPosition(), sample.position)
    )

    if (sample.valid) {
      this.reticle.setLocked()
      if (!this.hadValidSurface) {
        this.audio?.playSurfaceLock()
        this.hadValidSurface = true
      }
    } else {
      this.reticle.setInvalid()
      this.hadValidSurface = false
    }
  }

  private applySampleToHint(sample: SurfaceSample): void {
    if (sample.valid) {
      this.uiHint.setHint("Surface found", "Pinch to place DeskOS here", true)
      return
    }
    switch (sample.reject) {
      case SurfaceReject.NotHorizontal:
        this.uiHint.setHint("Not a flat surface", "Aim at a desk, table or the floor", false)
        break
      case SurfaceReject.FacingAway:
        this.uiHint.setHint("Surface is above you", "Aim at a desk, table or the floor", false)
        break
      case SurfaceReject.TooClose:
        this.uiHint.setHint("Too close", "Step back a little and aim again", false)
        break
      case SurfaceReject.TooFar:
        this.uiHint.setHint("Too far away", "Move closer to the surface", false)
        break
      default:
        this.uiHint.setHint("Find a flat surface", "Look at a table or desk, then pinch to place", false)
        break
    }
  }

  private showReticle(visible: boolean): void {
    if (this.reticleVisible === visible) return
    this.reticleVisible = visible
    this.reticle.setVisible(visible)
  }

  /** Park the hint card in front of the user, facing them, with a little lag. */
  private updateHintPose(dt: number): void {
    const hintObj = this.uiHint.getSceneObject()
    // Lifted above the gaze centre so the card never occludes the reticle or the
    // surface the user is aiming at.
    const target = this.camera
      .getForwardPosition(HINT_DISTANCE_CM)
      .add(this.camera.up().uniformScale(HINT_VERTICAL_OFFSET_CM))
    if (this.hintPos === null) this.hintPos = target

    const k = Math.min(1, dt * HINT_FOLLOW_SPEED)
    this.hintPos = vec3.lerp(this.hintPos, target, k)

    const tr = hintObj.getTransform()
    tr.setWorldPosition(this.hintPos)
    tr.setWorldRotation(billboardRotation(this.hintPos, this.camera.getWorldPosition()))
  }

  // ── Placement ─────────────────────────────────────────────────────────────

  private placeDesk(position: vec3, normal: vec3): void {
    const cameraPos = this.camera.getWorldPosition()

    this.anchorOrigin = position
    this.anchorNormal = normal.normalize()
    this.anchorRotation = deskAnchorRotation(this.anchorNormal, cameraPos, position)

    if (this.deskAnchor === null) {
      this.buildDesk()
    }

    const anchorTr = this.deskAnchor!.getTransform()
    anchorTr.setWorldPosition(this.anchorOrigin)
    anchorTr.setWorldRotation(this.anchorRotation)

    this.state = DeskState.Placed
    // Depth computation runs for as long as the session is started, and nothing
    // probes it once we are Placed — leaving it running burns power and thermal
    // budget for the rest of the Lens. enterPlacingMode() starts it again.
    this.placer?.stop()
    this.showReticle(false)
    this.uiHint.setPanelVisible(false)
    this.uiDesk.setPanelVisible(true)
    this.uiDesk.setStatus("Anchored to surface")
    this.audio?.playDeskPlace()
  }

  /**
   * Build the world-anchored desk once. DeskAnchor is created at the SCENE ROOT
   * (no parent) so it holds a fixed world pose — parenting it to the camera is
   * exactly the bug that would make the desk head-locked instead of anchored.
   */
  private buildDesk(): void {
    const anchor = global.scene.createSceneObject("DeskAnchor")
    this.deskAnchor = anchor

    // Re-parent the UI panel onto the anchor. setParent keeps LOCAL transform,
    // so we then set the local pose that lays the panel flat on the surface:
    // a -90 deg X rotation maps panel-local +Z (its normal) onto anchor +Y.
    const deskObj = this.uiDesk.getSceneObject()
    deskObj.setParent(anchor)
    const deskTr = deskObj.getTransform()
    deskTr.setLocalPosition(new vec3(0, TRAY_SURFACE_LIFT, 0))
    deskTr.setLocalRotation(quat.angleAxis(-Math.PI / 2, vec3.right()))
    deskTr.setLocalScale(vec3.one())

    this.buildHandle(anchor)
  }

  /**
   * The drag handle: a physical knob the user grabs to slide the whole desk.
   *
   * Wrapper pattern — the collider lives on a unit-scale, identity-rotation
   * wrapper positioned at mesh_position + aabb_center_offset, and the GLB is a
   * leaf child. That keeps ColliderComponent.shape.size in true centimetres
   * (scale on a collider-bearing node silently rescales the hit volume).
   */
  private buildHandle(anchor: SceneObject): void {
    const wrapper = global.scene.createSceneObject("DeskHandleWrapper")
    wrapper.setParent(anchor)
    this.handleWrapper = wrapper

    const wrapperTr = wrapper.getTransform()
    wrapperTr.setLocalPosition(HANDLE_ANCHOR_POS.add(HANDLE_CENTER_OFFSET_CM))
    wrapperTr.setLocalRotation(quat.quatIdentity())
    wrapperTr.setLocalScale(vec3.one())

    // Leaf visual, offset back by the centre offset so the GLB's grounded base
    // (min-Y = 0) lands exactly on the surface. Default prefab scale preserves
    // the authored 3.4 cm — never setLocalScale here.
    const visual = handlePrefab.instantiate(wrapper)
    visual.name = "DeskHandleVisual"
    visual.getTransform().setLocalPosition(HANDLE_CENTER_OFFSET_CM.uniformScale(-1))

    const collider = wrapper.createComponent("Physics.ColliderComponent") as ColliderComponent
    const box = Shape.createBoxShape()
    box.size = HANDLE_COLLIDER_CM
    collider.shape = box
    collider.debugDrawEnabled = this.debugColliders

    wrapper.createComponent(Interactable.getTypeName())

    const manip = wrapper.createComponent(
      InteractableManipulation.getTypeName()
    ) as InteractableManipulation
    // Grab the knob, move the whole desk: SIK writes the manipulate root's
    // transform, so the wrapper stays put relative to the anchor and there is
    // no feedback loop between the handle and the thing it drags.
    manip.setManipulateRoot(anchor.getTransform())
    manip.setCanTranslate(true)
    manip.setCanRotate(false)
    manip.setCanScale(false)
    this.manipulation = manip

    manip.onManipulationStart.add(() => {
      this.isManipulating = true
      this.uiDesk.setStatus("Moving on surface")
    })
    manip.onManipulationEnd.add(() => {
      this.isManipulating = false
      this.uiDesk.setStatus("Anchored to surface")
    })

    void HANDLE_AABB_CM // documented above; size comes from the normalized GLB
  }

  /**
   * Keep the desk glued to the plane it was placed on.
   *
   * InteractableManipulation translates freely in 3D, which would let the user
   * lift the cards off the table. Every late frame we project the anchor back
   * onto the anchored plane and restore its rotation, so dragging the handle
   * slides the desk ACROSS the surface and can never pull it off.
   */
  private constrainToSurface(): void {
    if (this.state !== DeskState.Placed || this.deskAnchor === null) return

    // Deliberately NOT gated on isManipulating. SIK writes its final transform
    // in the Update phase of the same frame that onManipulationEnd clears that
    // flag, so gating on it leaves the last frame of a drag uncorrected. Keeping
    // the invariant unconditional also covers a manipulation that ends abnormally
    // (interactable disabled, tracking lost) without firing its end callback.
    // Idempotent: an anchor already on the plane produces no transform write.
    const tr = this.deskAnchor.getTransform()
    const pos = tr.getWorldPosition()
    const offset = pos.sub(this.anchorOrigin)
    const inPlane = projectOntoPlane(offset, this.anchorNormal)
    const corrected = this.anchorOrigin.add(inPlane)

    // Guard the writes: an unconditional setWorldPosition every frame would
    // dirty the whole UI subtree's transforms for no reason.
    if (corrected.sub(pos).length > 1e-4) {
      tr.setWorldPosition(corrected)
    }

    const rot = tr.getWorldRotation()
    const alignment = Math.abs(
      rot.x * this.anchorRotation.x +
        rot.y * this.anchorRotation.y +
        rot.z * this.anchorRotation.z +
        rot.w * this.anchorRotation.w
    )
    if (alignment < 0.99999) {
      tr.setWorldRotation(this.anchorRotation)
    }
  }

  // ── UI event handlers ─────────────────────────────────────────────────────

  private onFolderSelected(id: string): void {
    // Scope limit: selection is visible feedback only — no folder contents.
    const alreadySelected = this.uiDesk.getSelected() === id
    const next = alreadySelected ? null : id
    print("[DeskOS] folderSelected " + id + " was=" + this.uiDesk.getSelected() + " next=" + next)
    this.uiDesk.setSelected(next)
    this.uiDesk.setStatus(next === null ? "Anchored to surface" : `${this.uiDesk.getFolderTitle(next)} selected`)
    this.audio?.playCardSelect()
  }

  /** "Move" tapped — hide the desk and go back to surface hunting. */
  private enterPlacingMode(): void {
    this.state = DeskState.Placing
    this.uiDesk.setSelected(null)
    this.uiDesk.setPanelVisible(false)
    this.uiHint.setPanelVisible(true)
    this.uiHint.setHint("Find a flat surface", "Look at a table or desk, then pinch to place", false)
    this.hadValidSurface = false
    this.reticle.setSearching()
    this.placer?.start()
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  /**
   * Walks the scene tree and toggles debugDrawEnabled on every collider/body.
   * BodyComponent is checked separately because getComponent for
   * ColliderComponent does not return BodyComponents.
   */
  private setColliderDebugAll(obj: SceneObject, enable: boolean): void {
    const c = obj.getComponent("Physics.ColliderComponent") as ColliderComponent | null
    if (c) c.debugDrawEnabled = enable
    const b = obj.getComponent("Physics.BodyComponent") as ColliderComponent | null
    if (b) b.debugDrawEnabled = enable
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.setColliderDebugAll(obj.getChild(i), enable)
    }
  }
}
