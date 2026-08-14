import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {
  FlexAlign,
  FlexAlignSelf,
  FlexDirection,
  FlexJustify
} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import {InteractableManipulation} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"

import {ContentKind} from "./DeskOSTypes"

// ── Assets ───────────────────────────────────────────────────────────────────
const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material

const ICON_FOLDER = requireAsset("../Icons/folder.png") as Texture
const ICON_PROJECTS = requireAsset("../Icons/description.png") as Texture
const ICON_PHOTOS = requireAsset("../Icons/photo_camera.png") as Texture
const ICON_PERSONAL = requireAsset("../Icons/person.png") as Texture
const ICON_MOVE = requireAsset("../Icons/drag_indicator.png") as Texture
const ICON_FOLDER_OPEN = requireAsset("../Icons/folder_open.png") as Texture
const ICON_TEXT = requireAsset("../Icons/description.png") as Texture
const ICON_IMAGE = requireAsset("../Icons/image.png") as Texture
const ICON_VIDEO = requireAsset("../Icons/play_arrow.png") as Texture
const ICON_AUDIO = requireAsset("../Icons/graphic_eq.png") as Texture

// ── Typography: the single source of truth for text size + weight ────────────
//
// `Component.Text.size` is the glyph EM-SQUARE height:
//     em-square cm = size / 43.886           (StudioLib.d.ts -> Text.size)
// The scale is calibrated for the SnapOS system font at z = -110 cm. This panel
// lies flat on a real desk, so it is read from much closer than 110 cm — every
// role is applied at DESK_DIST, which scales the em-square down proportionally
// so the ANGULAR size stays right.
const FONT_SIZE_SCALE = 1.0 // 1.0 = SnapOS system-font metrics (no custom font baked).

type TextRole =
  | "Title1"
  | "Title2"
  | "HeadlineXL"
  | "Headline1"
  | "Headline2"
  | "Subheadline"
  | "Button"
  | "Callout"
  | "Body"
  | "Caption"

const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Title1: {size: 105, weight: 700},
  Title2: {size: 93, weight: 700},
  HeadlineXL: {size: 62, weight: 700},
  Headline1: {size: 54, weight: 700},
  Headline2: {size: 48, weight: 700},
  Subheadline: {size: 41, weight: 700},
  Button: {size: 39, weight: 500},
  Callout: {size: 39, weight: 700},
  Body: {size: 39, weight: 500},
  Caption: {size: 38, weight: 500}
}

function roleSize(role: TextRole, distanceCm: number = 110): number {
  return TYPE_SCALE[role].size * FONT_SIZE_SCALE * (distanceCm / 110)
}

function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = roleSize(role, distanceCm)
  ;(t as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}

/** Width budget for a text cell (R2). Scales with the role AND the focal distance. */
function textWidthCm(text: string, role: TextRole, distanceCm: number = 110): number {
  const perCharAt110 = TYPE_SCALE[role].size >= 54 ? 0.7 : 0.5
  return text.length * perCharAt110 * FONT_SIZE_SCALE * (distanceCm / 110) + 1.0
}

// ── Layout constants (cm, desk-local) ────────────────────────────────────────
// The mat is a workspace the folders move around inside, not a shelf that just
// holds them in a row — so it is sized for rearranging, not for a tight fit.
const TRAY_W = 58
const TRAY_H = 34
const PAD = 2.0
const INNER_W = TRAY_W - PAD * 2 // 38

const HEADER_H = 4.0
const CARD_W = 11
const CARD_H = 13
const ROW_GAP = 1.4

// The desk lies on a physical table; a seated user reads it from ~70 cm, not the
// 110 cm UI focal plane. Every role is applied at this distance.
const DESK_DIST = 70

const LAYOUT_Z_LIFT = 0.02
const CONTENT_Z_OFFSET = 0.08
const CARD_CONTENT_Z = 0.12

/** How far a selected card rises off the tray (desk-local +Z is the surface normal). */
const CARD_SELECTED_LIFT = 1.1
const CARD_LIFT_SPEED = 9.0

/** Lift per interaction state (cm off the mat). Priority: grabbed > hover > selected. */
const LIFT_HOVER = 0.55
const LIFT_GRABBED = 2.4

/** Uniform scale per state — reinforces the lift with a size cue. */
const SCALE_REST = 1.0
const SCALE_HOVER = 1.03
const SCALE_GRABBED = 1.07
const CARD_SCALE_SPEED = 12.0

const CARD_CORNER = 1.6

/** The mat itself — passive backing, deliberately darker than the cards. */
const MAT_FILL = new vec4(0.08, 0.09, 0.1, 0.85)
const MAT_CORNER = 2.4

/**
 * Halo cast on the mat under a lifted card — the "picked up" cue.
 *
 * NOT a drop shadow. Specs is an additive see-through display: black is simply
 * transparent, so a dark shadow renders as nothing at all. Lift has to be cued
 * with light, not with shade, so this is an accent-tinted glow that grows and
 * brightens as the card rises.
 */
const GLOW_COLOR = new vec4(0.35, 0.85, 0.92, 0.85)
const GLOW_MAX_SPREAD_CM = 2.6

/** Local Z of the folder layer and its parts (mat-local +Z is the surface normal). */
const FOLDERS_Z = 0.6
const GLOW_Z = 0.02
const CARD_BASE_Z = 0.15

/** Home positions (mat-local cm) where the folders start out. */
const FOLDER_HOME_X = [-15.5, 0, 15.5]
const FOLDER_HOME_Y = -3.0

/** Bounds for a card CENTRE: whole card stays on the mat and clear of the header. */
const CARD_BOUND_X = TRAY_W / 2 - CARD_W / 2 - 1.0
const CARD_BOUND_Y_MIN = -(TRAY_H / 2 - CARD_H / 2 - 1.0)
const CARD_BOUND_Y_MAX = TRAY_H / 2 - CARD_H / 2 - 1.0 - HEADER_H - 1.5

/**
 * Drag bounds for an object of the given footprint: fully on the mat and clear
 * of the header strip.
 *
 * Sized per object rather than per folder. Using the folder's bounds for a file
 * clamped files out of the upper mat entirely — including the ring slots they
 * rest in — so a file could not be dropped where it had just been sitting.
 * Feeding CARD_W/CARD_H in here reproduces CARD_BOUND_* exactly.
 */
function boundsFor(w: number, h: number): {x: number; yMin: number; yMax: number} {
  return {
    x: TRAY_W / 2 - w / 2 - 1.0,
    yMin: -(TRAY_H / 2 - h / 2 - 1.0),
    yMax: TRAY_H / 2 - h / 2 - 1.0 - HEADER_H - 1.5
  }
}

/** Travel (cm) past which a pinch counts as a reposition rather than a tap-select. */
const DRAG_SELECT_THRESHOLD = 1.2

// ── Folder contents ──────────────────────────────────────────────────────────



/**
 * Each kind is distinguishable three ways over, so it reads at a glance even in
 * peripheral vision: a different silhouette (aspect ratio), a different accent
 * hue, and a different body treatment (text lines / thumbnail / scrubber /
 * waveform). Colour alone would not survive the additive display washing out
 * over a bright desk.
 */
const KIND_SIZE: Record<ContentKind, vec2> = {
  text: new vec2(6.4, 7.8),
  image: new vec2(7.6, 6.6),
  video: new vec2(8.4, 6.0),
  audio: new vec2(7.6, 5.2)
}
const KIND_ACCENT: Record<ContentKind, vec4> = {
  text: new vec4(0.84, 0.88, 0.95, 1),
  image: new vec4(1.0, 0.72, 0.34, 1),
  video: new vec4(0.79, 0.56, 1.0, 1),
  audio: new vec4(0.42, 0.93, 0.62, 1)
}
const KIND_ICON: Record<ContentKind, Texture> = {
  text: ICON_TEXT,
  image: ICON_IMAGE,
  video: ICON_VIDEO,
  audio: ICON_AUDIO
}

interface ContentDef {
  kind: ContentKind
  name: string
  /** Object path in the `deskos` bucket once backed by real media. */
  storagePath?: string
  /** Size for documents/images, duration for time-based media. */
  meta: string
  /** Document body, text kind only — shown in the reader. */
  body?: string[]
  /**
   * A chip built empty and parked, kept only so captures have somewhere to
   * land. Chips cannot be created once the scene has started, so the pool has
   * to be bigger than what it initially shows.
   */
  reserve?: boolean
}

/** Mock contents — no file system behind them yet, purely representative. */
const CONTENTS: Record<string, ContentDef[]> = {
  Projects: [
    {
      kind: "text",
      name: "Roadmap",
      meta: "12 KB",
      body: [
        "Q3 — spatial shell",
        "Surface anchoring is done. Folders",
        "reposition on the detected plane and",
        "hold their pose across sessions.",
        "",
        "Next: contents become first-class",
        "objects, not just chips."
      ]
    },
    {
      kind: "text",
      name: "Spec v2",
      meta: "48 KB",
      body: [
        "Interaction model",
        "Every object on the desk answers to",
        "the same three states: hover, grabbed,",
        "released. Viewers stand up; files lie",
        "flat. Nothing is head-locked.",
        "",
        "Open question: multi-select."
      ]
    },
    {kind: "image", name: "Wireframe", meta: "PNG · 1.2 MB"},
    {kind: "video", name: "Demo reel", meta: "1:24"},
    // Reserves — built empty and parked so captures have somewhere to land.
    {kind: "image", name: "", meta: "", reserve: true},
    {kind: "image", name: "", meta: "", reserve: true},
    {kind: "text", name: "", meta: "", reserve: true}
  ],
  Photos: [
    {kind: "image", name: "Sunset", meta: "JPG · 3.8 MB"},
    {kind: "image", name: "Studio", meta: "JPG · 2.1 MB"},
    {kind: "image", name: "Team", meta: "JPG · 4.4 MB"},
    {kind: "video", name: "Timelapse", meta: "0:42"},
    // Reserves — built empty and parked so captures have somewhere to land.
    {kind: "image", name: "", meta: "", reserve: true},
    {kind: "image", name: "", meta: "", reserve: true},
    {kind: "text", name: "", meta: "", reserve: true}
  ],
  Personal: [
    {
      kind: "text",
      name: "Notes",
      meta: "3 KB",
      body: [
        "Desk setup",
        "Mat sits about 70 cm out, angled",
        "slightly left. Folders within reach",
        "without leaning.",
        "",
        "Try the ring at 13 cm next time."
      ]
    },
    {kind: "audio", name: "Voice memo", meta: "0:38"},
    {kind: "image", name: "Passport", meta: "JPG · 1.9 MB"},
    {kind: "audio", name: "Idea 04", meta: "1:05"},
    // Reserves — built empty and parked so captures have somewhere to land.
    {kind: "image", name: "", meta: "", reserve: true},
    {kind: "image", name: "", meta: "", reserve: true},
    {kind: "text", name: "", meta: "", reserve: true}
  ]
}

const KIND_LABEL: Record<ContentKind, string> = {
  text: "Document",
  image: "Image",
  video: "Video",
  audio: "Audio"
}

// ── Hover preview + spatial viewer ───────────────────────────────────────────

const PREVIEW_W = 12.0
const PREVIEW_H = 5.4
const PREVIEW_SPEED = 14.0
/** How far in front of the hovered chip (toward the user) the preview sits (cm). */
const PREVIEW_GAP = 4.2

const VIEWER_W = 32
const VIEWER_H = 20
/** Height of the standing viewer's centre above the mat (cm). */
const VIEWER_HEIGHT = 12
/** How far behind the file the viewer stands, away from the user (cm). */
const VIEWER_BACK_OFFSET = 8
/** Viewers stand up and lean back slightly, the way a monitor does. */
const VIEWER_TILT_DEG = 78
const VIEWER_START_SCALE = 0.22
const VIEWER_SPEED = 7.0
const VIEWER_MAX_X = 12
const VIEWER_TEXT_LINES = 7

interface PreviewHandles {
  root: SceneObject
  accent: RoundedRectangle
  name: Text
  meta: Text
}

interface ViewerHandles {
  root: SceneObject
  title: Text
  sub: Text
  bodies: Record<ContentKind, SceneObject>
  lines: Text[]
  /** The big image surface, swapped to the real photo when one is loaded. */
  imageSwatch: RoundedRectangle
  /** Plays whatever audio file the open viewer refers to. */
  audio: AudioComponent
}

// ── Release-time tidying ─────────────────────────────────────────────────────

/** Axis-align to a neighbour when released within this distance of it (cm). */
const SNAP_ALIGN_DIST = 2.8
/** Clearance an object is pushed out to when it lands overlapping a neighbour (cm). */
const SNAP_MIN_GAP = 1.2
/** How long the glide from the released spot to the tidied spot takes (seconds). */
const SETTLE_DUR = 0.22
/** Separation is iterated — one pass can push an object into a third neighbour. */
const SNAP_ITERATIONS = 3

// ── Spatial grouping ─────────────────────────────────────────────────────────

/**
 * A file released within this of a folder's centre joins that folder (cm).
 *
 * Comfortably wider than CONTENT_RING_RADIUS so a file dropped anywhere around
 * its own folder stays with it, and adoption resolves to the NEAREST folder —
 * which is what makes dragging a file over to a different folder work.
 */
const ADOPT_RADIUS = 13.0

/** The line drawn from a grouped file back to its folder. */
const TETHER_WIDTH = 0.26
const TETHER_OPACITY = 0.42
const TETHER_Z = CARD_BASE_Z + 0.05
/** Trimmed at both ends so it meets the objects rather than stabbing through them. */
const TETHER_INSET = 4.0

/**
 * A rival folder must be this much closer than the current owner to steal a
 * file (cm).
 *
 * Without it, reparenting happens by accident: the ring slots sit ~11.5 cm from
 * their own folder but only ~11 cm from the neighbouring one, so nudging a file
 * a centimetre would silently move it to the folder next door. Reparenting
 * should take intent.
 */
const ADOPT_HYSTERESIS = 3.5

/** Extra glow on the folder that would adopt the file currently being dragged. */
const ADOPT_GLOW_SPEED = 12.0

/** One thing on the desk, for the purposes of snapping. */
interface DeskItem {
  x: number
  y: number
  w: number
  h: number
  /** Identity, so an object never snaps to itself. */
  key: string
}

/** Hover response on a file chip. */
const CONTENT_HOVER_LIFT = 1.2
const CONTENT_HOVER_SCALE = 1.09
const CONTENT_HOVER_SPEED = 13.0

const CONTENT_BODY = new vec4(0.16, 0.17, 0.2, 0.95)
const LID_FILL = new vec4(0.21, 0.24, 0.28, 0.97)
const CONTENT_CORNER = 1.0

/**
 * Ring radius for the emerged contents (cm from the folder centre).
 *
 * 11.5 with items placed on the diagonals keeps a full four-item ring inside
 * the mat even for a folder parked at its far edge, and off the folder row's
 * own axis so contents never land squarely on a neighbouring folder.
 */
const CONTENT_RING_RADIUS = 11.5
const CONTENT_RING_START_DEG = 45

/** How high contents float above the mat once fully out (cm). */
const CONTENT_LIFT = 3.2

/** Per-item emergence duration and the gap between successive items (seconds). */
const CONTENT_ITEM_DUR = 0.55
const CONTENT_STAGGER = 0.12

/** Nothing emerges until the lid is meaningfully open (seconds). */
const CONTENT_START_DELAY = 0.14

/**
 * Where a chip begins its journey: below the mat plane, so the mat itself hides
 * it until it rises through the folder. Starting it above the mat and merely
 * scaling from zero is what makes contents look like UI appearing rather than
 * objects coming out of something.
 */
const CONTENT_START_Z = -2.2
const CONTENT_START_SCALE = 0.5

/**
 * A file sits on edge inside a folder and gets laid flat on the desk, so each
 * chip starts steeply tilted and levels off as it settles. Kept at 55 deg (not
 * fully upright) so that even the tallest chip stays under the mat at its start
 * scale — otherwise the top edge pokes through the desk before it emerges.
 */
const CONTENT_START_TILT_DEG = 55

/** Peak of the lift arc above the resting height (cm). */
const CONTENT_ARC_HEIGHT = 2.2

/** Emergence point, offset toward the lid hinge so chips come out from under it (cm). */
const CONTENT_ORIGIN_Y = CARD_H * 0.16

/** Folder lift while open — above hover, below grabbed. */
const LIFT_OPEN = 1.8

/** Lid hinge sweep and how long it takes (degrees, seconds). */
const LID_OPEN_DEG = 74
const LID_DUR = 0.34
const LID_Z = -0.06

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Decelerating ease — rise, scale and tilt all use it. */
function easeOutCubic(t: number): number {
  const x = 1 - t
  return 1 - x * x * x
}

/** Overshoot easing — gives the contents a little settle as they arrive. */
function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  const x = t - 1
  return 1 + c3 * x * x * x + c1 * x * x
}

const COLOR_PRIMARY = new vec4(1, 1, 1, 1)
const COLOR_SECONDARY = new vec4(1, 1, 1, 0.6)
const COLOR_ACCENT = new vec4(0.35, 0.85, 0.92, 1)

interface FolderDef {
  id: string
  title: string
  subtitle: string
  icon: Texture
}

// Every visible string on this panel lives here — the main script never authors text.
const FOLDERS: FolderDef[] = [
  {id: "Projects", title: "Projects", subtitle: "Work in progress", icon: ICON_PROJECTS},
  {id: "Photos", title: "Photos", subtitle: "Captures & media", icon: ICON_PHOTOS},
  {id: "Personal", title: "Personal", subtitle: "Private files", icon: ICON_PERSONAL}
]

interface CardHandles {
  def: FolderDef
  root: SceneObject
  button: Button
  glow: RoundedRectangle
  glowObj: SceneObject
  /** Interaction state — highest priority wins for lift / scale / colour. */
  hovered: boolean
  grabbed: boolean
  selected: boolean
  /** Smoothed visual values. */
  lift: number
  scale: number
  /** Mat-local position at grab start, for telling a drag from a tap. */
  grabStartX: number
  grabStartY: number
  dragged: boolean
  /** Smoothed highlight while this folder is the adoption candidate for a drag. */
  adoptGlow: number
  /** Release-time settle: glide from where it was let go to where it tidies up. */
  settleT: number
  settleFromX: number
  settleFromY: number
  settleToX: number
  settleToY: number
  snapPending: boolean
  /** Open/close animation clock, in seconds, walking between 0 and openDuration. */
  openTime: number
  openDuration: number
  lidPivot: SceneObject
  icon: Image
  iconIsOpen: boolean
  contents: ContentHandles[]
}

interface ContentHandles {
  def: ContentDef
  root: SceneObject
  /** Ring angle in radians, fixed at build time. */
  angle: number
  /** Emergence start offset in seconds. */
  delay: number
  hovered: boolean
  grabbed: boolean
  /** True only once the chip has fully settled — no interacting with one in flight. */
  interactive: boolean
  /** Smoothed 0..1 hover response. */
  hoverAmount: number
  /**
   * Resting spot in mat-local cm. Tracks the folder's ring slot until the user
   * moves the file, after which it is pinned and stops following the folder —
   * a deliberate placement should not be undone by dragging the folder later.
   */
  restX: number
  restY: number
  pinned: boolean
  /** Folder this file belongs to. Drives which folder it emerges from. */
  ownerId: string
  /**
   * Whether it travels with its folder. Set on release by proximity: dropped
   * near a folder it joins and follows; dropped out in the open it stays put.
   */
  grouped: boolean
  /** Rigid offset from the owner while grouped and pinned. */
  offsetX: number
  offsetY: number
  /** Rate-limited emergence progress, so an ownership change animates. */
  p: number
  tether: RoundedRectangle
  tetherObj: SceneObject
  /** Re-skinnable pieces — rewritten when cloud content arrives. */
  nameText: Text
  /** Image kind only: the swatch that becomes a real thumbnail. */
  thumb: RoundedRectangle | null
  /** Mat-local spot where the current grab began, for telling a drag from a tap. */
  grabStartX: number
  grabStartY: number
  dragged: boolean
  settleT: number
  settleFromX: number
  settleFromY: number
  settleToX: number
  settleToY: number
  snapPending: boolean
}

/**
 * DeskOS desk surface — a UIKit tray holding three folder cards.
 *
 * The root SceneObject is positioned AND oriented by DeskOS.ts so this panel
 * lies face-up on a detected physical surface. Everything below is authored in
 * ordinary panel-local XY, exactly like a vertical panel would be; the parent's
 * rotation is what lays it flat.
 */
@component
export class DeskOSUI extends BaseScriptComponent {
  private statusText: Text | null = null
  private recordButton: Button | null = null
  private cards: CardHandles[] = []
  private selectedId: string | null = null

  // The desk is hidden until the user places it. It must NOT be disabled during
  // onAwake: UIKit `Element` binds initialize() to OnStartEvent, and a SceneObject
  // disabled before start never fires OnStart for its components — the shapes,
  // layouts and Button would never initialize and the panel could never be shown
  // again.
  // So we disable at the TAIL of our own OnStartEvent (registered after buildUI,
  // therefore after every Element's own OnStart binding) and gate on wantVisible.
  private started = false
  private wantVisible = false


  private _onFolderSelected = new Event<string>()
  private _onFolderHoverEnter = new Event<string>()
  private preview: PreviewHandles | null = null
  private previewAmount = 0
  private hoveredItem: ContentHandles | null = null

  private viewer: ViewerHandles | null = null
  private viewerItem: ContentHandles | null = null
  private viewerFrom: vec3 = vec3.zero()
  private viewerT = 0

  private _onFileHover = new Event<string>()
  private _onFileRegrouped = new Event<string>()
  private _onFileOpened = new Event<string>()
  private _onFolderGrabbed = new Event<string>()
  private _onFolderReleased = new Event<string>()
  private _onMoveRequested = new Event<void>()
  private _onCapturePhoto = new Event<void>()
  private _onToggleRecord = new Event<void>()

  /** Fires when the user pinch-selects a folder card. Payload is the folder id. */
  get onFolderSelected(): PublicApi<string> {
    return this._onFolderSelected.publicApi()
  }

  /** Fires when a hand/cursor starts hovering a card. Payload is the folder id. */
  get onFolderHoverEnter(): PublicApi<string> {
    return this._onFolderHoverEnter.publicApi()
  }

  /** Fires when the pointer enters a settled file chip. Payload is the file name. */
  get onFileHover(): PublicApi<string> {
    return this._onFileHover.publicApi()
  }

  /** Fires when a file changes folder. Payload is "<file> → <folder>". */
  get onFileRegrouped(): PublicApi<string> {
    return this._onFileRegrouped.publicApi()
  }

  /** Fires when a file's spatial viewer is opened. Payload is the file name. */
  get onFileOpened(): PublicApi<string> {
    return this._onFileOpened.publicApi()
  }

  /** Fires when a folder is pinched and picked up. Payload is the folder id. */
  get onFolderGrabbed(): PublicApi<string> {
    return this._onFolderGrabbed.publicApi()
  }

  /** Fires when a picked-up folder is released onto the surface. */
  get onFolderReleased(): PublicApi<string> {
    return this._onFolderReleased.publicApi()
  }

  /** Fires when the user taps the camera affordance. */
  get onCapturePhoto(): PublicApi<void> {
    return this._onCapturePhoto.publicApi()
  }

  /** Fires when the user taps the voice-memo affordance (start or stop). */
  get onToggleRecord(): PublicApi<void> {
    return this._onToggleRecord.publicApi()
  }

  /** Fires when the user taps "Move" to re-place the desk on a surface. */
  get onMoveRequested(): PublicApi<void> {
    return this._onMoveRequested.publicApi()
  }

  onAwake(): void {
    this.buildUI()
    this.createEvent("OnStartEvent").bind(() => {
      this.started = true
      this.sceneObject.enabled = this.wantVisible
    })
    // LateUpdate, not Update: InteractableManipulation writes the card's world
    // transform during Update, so the constraint has to run after it or a
    // dragged card visibly leaves the mat for a frame.
    this.createEvent("LateUpdateEvent").bind(() => this.updateFolders())
  }

  // ── Public API — the main script pushes state in through these ─────────────

  /** Show/hide the whole desk. Safe to call before OnStart (deferred via wantVisible). */
  setPanelVisible(visible: boolean): void {
    this.wantVisible = visible
    if (this.started) this.sceneObject.enabled = visible
  }

  setStatus(message: string): void {
    if (this.statusText) this.statusText.text = message
  }

  /** Radio-select a card (or pass null to clear). Drives toggle state + lift. */
  setSelected(id: string | null): void {
    this.selectedId = id
    for (const card of this.cards) {
      card.selected = card.def.id === id
      card.button.isOn = card.selected
    }
  }

  getSelected(): string | null {
    return this.selectedId
  }

  /** Title text for a folder id — so the main script never hardcodes a label. */
  getFolderTitle(id: string): string {
    for (const f of FOLDERS) {
      if (f.id === id) return f.title
    }
    return id
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  private buildUI(): void {
    // Canvas at the root — SortingType.Hierarchy (default): depth-first
    // hierarchy order IS render order. Never set renderOrder in this subtree.
    this.sceneObject.createComponent("Component.Canvas")

    // Mat FIRST so the hierarchy DFS paints it behind everything else.
    //
    // Deliberately a bare RoundedRectangle rather than a UIKit BackPlate:
    // BackPlate ships an Interactable + InteractionPlane whose collider spans
    // the whole panel and sits ON the mat plane. The folder cards float barely
    // 0.15 cm above that, so the plane swallowed every ray before it could
    // reach a card and nothing was draggable. The mat is passive scenery — it
    // has no business owning a collider.
    const mat = this.sceneObject.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    mat.size = new vec2(TRAY_W, TRAY_H)
    mat.cornerRadius = MAT_CORNER
    mat.backgroundColor = MAT_FILL

    // Content AFTER the tray so the DFS paints it on top. +0.6 breaks the
    // depth-buffer tie against the tray's ~1 cm thickness.
    const content = this.obj(this.sceneObject, "Content", new vec3(0, 0, 0.6))
    const col = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    col.width = TRAY_W
    col.height = TRAY_H
    col.direction = FlexDirection.Column
    col.alignItems = FlexAlign.Stretch
    col.justifyContent = FlexJustify.Start
    col.rowGap = ROW_GAP
    col.paddingTop = PAD
    col.paddingBottom = PAD
    col.paddingLeft = PAD
    col.paddingRight = PAD

    this.buildHeader(content)

    // Folders live outside the
    // flex column deliberately: FlexLayout rewrites the X/Y of every laid-out
    // child on each pass, which would overwrite a drag the frame it happened.
    // Their container has no layout, so a card keeps exactly the position the
    // user drops it at.
    this.buildFolders()

  }

  private buildHeader(parent: SceneObject): void {
    this.flexChild(parent, {w: INNER_W, h: HEADER_H}, (headerObj) => {
      const row = this.flexRow(headerObj, INNER_W, HEADER_H, {
        justify: FlexJustify.SpaceBetween,
        align: FlexAlign.Center,
        gap: 1.0
      })

      // Left: folder glyph + wordmark.
      this.flexChild(row, {w: 14, h: HEADER_H}, (leftObj) => {
        const leftRow = this.flexRow(leftObj, 14, HEADER_H, {
          justify: FlexJustify.Start,
          align: FlexAlign.Center,
          gap: 0.7
        })
        this.addIcon(leftRow, ICON_FOLDER, 2.0, COLOR_ACCENT)
        this.addRowText(leftRow, "DeskOS", "Headline1", COLOR_PRIMARY)
      })

      // Right: live status line + the Move affordance.
      this.flexChild(row, {w: 34, h: HEADER_H}, (rightObj) => {
        const rightRow = this.flexRow(rightObj, 34, HEADER_H, {
          justify: FlexJustify.End,
          align: FlexAlign.Center,
          gap: 1.0
        })
        this.statusText = this.addRowText(
          rightRow,
          "Anchored to surface",
          "Caption",
          COLOR_SECONDARY,
          11.0
        )
        this.recordButton = this.addHeaderButton(
          rightRow,
          "RecordButton",
          "Memo",
          ICON_AUDIO,
          () => this._onToggleRecord.invoke()
        )
        this.addHeaderButton(rightRow, "PhotoButton", "Photo", ICON_IMAGE, () =>
          this._onCapturePhoto.invoke()
        )
        this.addMoveButton(rightRow)
      })
    })
  }

  /** Same construction as the Move affordance, with a caller-supplied action. */
  private addHeaderButton(
    parent: SceneObject,
    name: string,
    label: string,
    icon: Texture,
    onTap: () => void
  ): Button {
    const btnW = 7.0
    const btnH = 2.8

    const so = this.obj(parent, name)
    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(btnW, btnH, 1) // BEFORE init

    const face = this.obj(so, name + "Face", new vec3(0, 0, CONTENT_Z_OFFSET))
    const faceRow = face.createComponent(FlexLayout.getTypeName()) as FlexLayout
    faceRow.direction = FlexDirection.Row
    faceRow.justifyContent = FlexJustify.Center
    faceRow.alignItems = FlexAlign.Center
    faceRow.columnGap = 0.4
    faceRow.width = btnW
    faceRow.height = btnH
    this.addIcon(face, icon, 1.5, COLOR_PRIMARY)
    this.addRowText(face, label, "Button", COLOR_PRIMARY)

    so.createComponent(FlexItem.getTypeName())

    const bind = (): void => {
      btn.onTriggerUp.add(() => onTap())
    }
    if (this.started) bind()
    else this.createEvent("OnStartEvent").bind(bind)

    return btn
  }

  private addMoveButton(parent: SceneObject): void {
    const label = "Move"
    const btnW = 7.5
    const btnH = 2.8

    const so = this.obj(parent, "MoveButton")
    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(btnW, btnH, 1) // BEFORE init

    // Icon + label sit on the button face, lifted clear of it.
    const face = this.obj(so, "MoveFace", new vec3(0, 0, CONTENT_Z_OFFSET))
    const faceRow = face.createComponent(FlexLayout.getTypeName()) as FlexLayout
    faceRow.direction = FlexDirection.Row
    faceRow.justifyContent = FlexJustify.Center
    faceRow.alignItems = FlexAlign.Center
    faceRow.columnGap = 0.4
    faceRow.width = btnW
    faceRow.height = btnH
    this.addIcon(face, ICON_MOVE, 1.5, COLOR_PRIMARY)
    this.addRowText(face, label, "Button", COLOR_PRIMARY)

    so.createComponent(FlexItem.getTypeName())
    btn.onTriggerUp.add(() => this._onMoveRequested.invoke())
  }

  private buildFolders(): void {
    const folders = this.obj(this.sceneObject, "Folders", new vec3(0, 0, FOLDERS_Z))

    // Every glow is created before any card so the hierarchy DFS paints all
    // glows behind all cards — including a card dragged over a neighbour.
    const glows: {rr: RoundedRectangle; so: SceneObject}[] = []
    for (let i = 0; i < FOLDERS.length; i++) {
      const so = this.obj(
        folders,
        "Glow_" + FOLDERS[i].id,
        new vec3(FOLDER_HOME_X[i], FOLDER_HOME_Y, GLOW_Z)
      )
      const rr = so.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
      rr.size = new vec2(CARD_W, CARD_H)
      rr.cornerRadius = CARD_CORNER
      rr.backgroundColor = GLOW_COLOR
      rr.opacity = 0
      glows.push({rr, so})
    }

    for (let i = 0; i < FOLDERS.length; i++) {
      this.addFolder(
        folders,
        FOLDERS[i],
        new vec3(FOLDER_HOME_X[i], FOLDER_HOME_Y, CARD_BASE_Z),
        glows[i].rr,
        glows[i].so
      )
    }

    // After every card, so hierarchy DFS paints contents above all of them.
    for (const card of this.cards) {
      this.buildContents(folders, card)
    }

    // Last of all, so the preview and viewer paint above every chip.
    this.buildPreview(folders)
    this.buildViewer(folders)
  }

  // ── Hover preview ─────────────────────────────────────────────────────────

  private buildPreview(parent: SceneObject): void {
    const root = this.obj(parent, "FilePreview")
    const body = root.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    body.size = new vec2(PREVIEW_W, PREVIEW_H)
    body.cornerRadius = CONTENT_CORNER
    body.backgroundColor = CONTENT_BODY

    // Left edge bar, recoloured per kind — the preview inherits the file's identity.
    const barObj = this.obj(root, "Accent", new vec3(-PREVIEW_W / 2 + 0.7, 0, 0.06))
    const accent = barObj.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    accent.size = new vec2(0.5, PREVIEW_H - 1.4)
    accent.cornerRadius = 0.25
    accent.backgroundColor = KIND_ACCENT.image

    const name = this.freeText(root, "Name", new vec3(0.5, 1.0, 0.08), "Headline2", COLOR_PRIMARY, PREVIEW_W - 2.6)
    const meta = this.freeText(root, "Meta", new vec3(0.5, -1.1, 0.08), "Caption", COLOR_SECONDARY, PREVIEW_W - 2.6)

    root.enabled = false
    this.preview = {root, accent, name, meta}
  }

  /** A Text positioned by hand rather than by a layout. */
  private freeText(
    parent: SceneObject,
    label: string,
    pos: vec3,
    role: TextRole,
    color: vec4,
    widthCM: number
  ): Text {
    const so = this.obj(parent, label, pos)
    const t = so.createComponent("Component.Text") as Text
    t.text = ""
    t.depthTest = true
    applyTextRole(t, role, DESK_DIST)
    t.textFill.color = color
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.0, 1.0)
    return t
  }

  private updatePreview(dt: number): void {
    const p = this.preview
    if (p === null) return

    const item = this.hoveredItem
    const target = item !== null ? 1 : 0
    this.previewAmount += (target - this.previewAmount) * Math.min(1, dt * PREVIEW_SPEED)

    if (this.previewAmount < 0.01 && target === 0) {
      if (p.root.enabled) p.root.enabled = false
      return
    }
    if (!p.root.enabled) p.root.enabled = true

    if (item !== null) {
      // Sits in FRONT of the chip (toward the user) so it never covers the thing
      // being described.
      const chip = item.root.getTransform().getLocalPosition()
      const gap = KIND_SIZE[item.def.kind].y / 2 + PREVIEW_H / 2 + PREVIEW_GAP
      p.root
        .getTransform()
        .setLocalPosition(new vec3(chip.x, chip.y - gap, CONTENT_LIFT + 1.4))
    }
    const e = easeOutCubic(clamp01(this.previewAmount))
    p.root.getTransform().setLocalScale(new vec3(e, e, 1))
  }

  // ── Cloud content ─────────────────────────────────────────────────────────

  /**
   * Replace the built-in sample content with what the backend returned.
   *
   * Chips CANNOT be created here. A file chip's SIK Interactable only registers
   * if the chip existed when the scene started, and cloud data arrives long
   * after — so the pool built in onAwake is re-skinned in place instead, and a
   * cloud file is only shown if the pool still has a chip of the same kind in
   * that folder (silhouette, icon and body treatment are all baked per kind).
   *
   * Anything the pool cannot seat is reported rather than silently dropped.
   */
  applyCloudDesk(
    folders: {slug: string; title: string; subtitle: string}[],
    files: {
      folderSlug: string
      kind: ContentKind
      name: string
      meta: string
      body: string[] | null
      storagePath: string | null
    }[]
  ): {seated: number; unseated: string[]} {
    for (const f of folders) {
      const card = this.cardById(this.titleCaseSlug(f.slug))
      if (card === null) continue
      card.def.title = f.title
      card.def.subtitle = f.subtitle
    }

    // Every chip starts unclaimed; whatever is left over gets hidden.
    const claimed: ContentHandles[] = []
    const unseated: string[] = []

    for (const file of files) {
      const card = this.cardById(this.titleCaseSlug(file.folderSlug))
      if (card === null) {
        unseated.push(file.name)
        continue
      }
      let seat: ContentHandles | null = null
      for (const chip of card.contents) {
        if (chip.def.kind !== file.kind) continue
        if (claimed.indexOf(chip) >= 0) continue
        seat = chip
        break
      }
      if (seat === null) {
        unseated.push(file.name)
        continue
      }
      claimed.push(seat)

      seat.def.name = file.name
      seat.def.meta = file.meta
      seat.def.body = file.body === null ? undefined : file.body
      seat.def.storagePath = file.storagePath === null ? undefined : file.storagePath
      seat.nameText.text = file.name
      seat.nameText.layoutRect = this.captionRect(file.name)
    }

    for (const card of this.cards) {
      for (const chip of card.contents) {
        if (claimed.indexOf(chip) >= 0) continue
        chip.def.name = ""
        chip.nameText.text = ""
        chip.root.enabled = false
        chip.tetherObj.enabled = false
        // Parked outside the pool so the open animation never revives it.
        chip.delay = Number.MAX_VALUE
      }
    }

    for (const card of this.cards) this.reflowRing(card)

    return {seated: claimed.length, unseated}
  }

  /**
   * Folders as the brain is allowed to see them.
   *
   * Includes what each folder currently holds, because filing by theme needs to
   * know the theme — "Projects" says far less about where a photo belongs than
   * the fact that it already holds a roadmap and a spec.
   */
  folderChoices(): {slug: string; title: string; examples: string[]}[] {
    const out: {slug: string; title: string; examples: string[]}[] = []
    for (const card of this.cards) {
      const examples: string[] = []
      for (const chip of card.contents) {
        // Not root.enabled — every chip in a closed folder is disabled, so that
        // would report an entire folder as empty. Parked is the real test.
        if (chip.delay === Number.MAX_VALUE) continue
        if (chip.def.name.length === 0) continue
        examples.push(chip.def.name)
      }
      out.push({slug: card.def.id.toLowerCase(), title: card.def.title, examples})
    }
    return out
  }

  /**
   * Give a freshly captured file a home on the desk.
   *
   * Same constraint as applyCloudDesk, same answer: chips cannot be created
   * once the scene has started, so a capture claims one the pool is holding in
   * reserve — a chip of the right kind that no cloud file seated and that
   * applyCloudDesk therefore parked. This is why the pool is deliberately
   * larger than the seeded content.
   *
   * Returns false when that folder has no reserve left of this kind, so the
   * caller can say so out loud instead of dropping the capture on the floor.
   */
  seatCapture(
    folderSlug: string,
    kind: ContentKind,
    name: string,
    meta: string,
    body: string[] | null
  ): boolean {
    const card = this.cardById(this.titleCaseSlug(folderSlug))
    if (card === null) return false

    let seat: ContentHandles | null = null
    for (const chip of card.contents) {
      if (chip.def.kind !== kind) continue
      // Parked, not disabled: a closed folder disables all of its chips.
      if (chip.delay < Number.MAX_VALUE) continue
      seat = chip
      break
    }
    if (seat === null) return false

    seat.def.name = name
    seat.def.meta = meta
    seat.def.body = body === null ? undefined : body
    seat.def.storagePath = undefined
    seat.nameText.text = name
    seat.nameText.layoutRect = this.captionRect(name)

    // Undo the parking. delay 0 puts the new file at the front of the
    // emergence queue rather than the back — a capture should come out first,
    // not wait behind everything already on the desk. p starts at 0 so the
    // rate limiter animates it out over CONTENT_ITEM_DUR even when the folder
    // is already open and its clock is long past.
    // Rejoin the ring first so every chip gets an even share of it, then
    // jump the queue: a capture should come out in front of what is already
    // on the desk, not wait behind it. p starts at 0 so the rate limiter
    // animates it even when the folder is open and its clock has run on.
    seat.delay = 0
    this.reflowRing(card)
    seat.delay = 0
    seat.p = 0
    seat.pinned = false
    seat.grouped = true
    seat.ownerId = card.def.id
    seat.interactive = false
    this.refreshOpenDuration(card)

    // Open the folder it landed in, so the arrival is something the user
    // watches rather than something that happened behind a closed lid.
    this.setSelected(card.def.id)
    return true
  }

  /** Apply a downloaded photo to a file's chip thumbnail. */
  setFileTexture(name: string, texture: Texture): void {
    for (const card of this.cards) {
      for (const chip of card.contents) {
        if (chip.def.name !== name || chip.thumb === null) continue
        chip.thumb.useTexture = true
        chip.thumb.texture = texture
        chip.thumb.opacity = 1
      }
    }
  }

  /** The open viewer's big image surface. */
  setViewerTexture(texture: Texture): void {
    const v = this.viewer
    if (v === null) return
    v.imageSwatch.useTexture = true
    v.imageSwatch.texture = texture
    v.imageSwatch.opacity = 1
  }

  /** Hand the open viewer a track and start it. */
  playViewerAudio(track: AudioTrackAsset): void {
    const v = this.viewer
    if (v === null) return
    v.audio.audioTrack = track
    v.audio.play(1)
  }

  /** Storage path of the file whose viewer is open, if it has one. */
  getOpenFile(): {name: string; kind: ContentKind; storagePath: string | null} | null {
    const item = this.viewerItem
    if (item === null) return null
    return {
      name: item.def.name,
      kind: item.def.kind,
      storagePath: item.def.storagePath === undefined ? null : item.def.storagePath
    }
  }

  private titleCaseSlug(slug: string): string {
    if (slug.length === 0) return slug
    return slug.charAt(0).toUpperCase() + slug.slice(1)
  }

  private captionRect(text: string): Rect {
    const w = textWidthCm(text, "Caption", DESK_DIST)
    return Rect.create(-w / 2, w / 2, -0.8, 0.8)
  }

  // ── Spatial viewer ────────────────────────────────────────────────────────

  /**
   * One viewer panel, reused for every file.
   *
   * All four bodies are built up front and only the matching one is enabled —
   * cheaper than tearing panels down and rebuilding them, and it keeps every
   * viewer's chrome (title, metadata, close) identical across types.
   *
   * Files lie flat on the desk; a viewer STANDS UP and leans back like a
   * monitor. That difference is what separates "a thing on my desk" from "a
   * thing I am reading".
   */
  private buildViewer(parent: SceneObject): void {
    const root = this.obj(parent, "FileViewer")
    const panel = root.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    panel.size = new vec2(VIEWER_W, VIEWER_H)
    panel.cornerRadius = 1.6
    panel.backgroundColor = new vec4(0.1, 0.11, 0.13, 0.97)

    const title = this.freeText(
      root,
      "Title",
      new vec3(-2.0, VIEWER_H / 2 - 2.2, 0.1),
      "Headline1",
      COLOR_PRIMARY,
      VIEWER_W - 12
    )
    const sub = this.freeText(
      root,
      "Sub",
      new vec3(-2.0, VIEWER_H / 2 - 4.4, 0.1),
      "Caption",
      COLOR_SECONDARY,
      VIEWER_W - 12
    )

    const closeObj = this.obj(
      root,
      "Close",
      new vec3(VIEWER_W / 2 - 3.6, VIEWER_H / 2 - 2.6, 0.12)
    )
    const closeBtn = closeObj.createComponent(Button.getTypeName()) as Button
    closeBtn.size = new vec3(5.0, 3.2, 1)
    this.freeText(closeObj, "CloseLabel", new vec3(0, 0, 0.14), "Caption", COLOR_PRIMARY, 4.6).text =
      "Close"

    const lines: Text[] = []
    const swatchRef: {swatch: RoundedRectangle | null} = {swatch: null}
    const bodies: Record<ContentKind, SceneObject> = {
      text: this.buildViewerText(root, lines),
      image: this.buildViewerImage(root, swatchRef),
      video: this.buildViewerVideo(root),
      audio: this.buildViewerAudio(root)
    }

    // One player for the whole viewer — the open file's track is swapped in.
    const audio = root.createComponent("Component.AudioComponent") as AudioComponent
    audio.volume = 0.9

    root.enabled = false
    this.viewer = {
      root,
      title,
      sub,
      bodies,
      lines,
      imageSwatch: swatchRef.swatch as RoundedRectangle,
      audio
    }

    const bind = (): void => {
      closeBtn.onTriggerUp.add(() => {
        this.viewerItem = null
      })
    }
    if (this.started) bind()
    else this.createEvent("OnStartEvent").bind(bind)
  }

  private viewerBody(root: SceneObject, name: string): SceneObject {
    const c = this.obj(root, name, new vec3(0, -2.2, 0.09))
    c.enabled = false
    return c
  }

  private buildViewerText(root: SceneObject, lines: Text[]): SceneObject {
    const c = this.viewerBody(root, "BodyText")
    for (let i = 0; i < VIEWER_TEXT_LINES; i++) {
      const t = this.freeText(
        c,
        "Line" + i,
        new vec3(0, 4.6 - i * 1.55, 0),
        "Caption",
        i === 0 ? COLOR_PRIMARY : COLOR_SECONDARY,
        VIEWER_W - 6
      )
      t.horizontalAlignment = HorizontalAlignment.Left
      lines.push(t)
    }
    return c
  }

  private buildViewerImage(root: SceneObject, refs: {swatch: RoundedRectangle | null}): SceneObject {
    const c = this.viewerBody(root, "BodyImage")
    const sw = this.obj(c, "Swatch", new vec3(0, 0, 0))
    const rr = sw.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    refs.swatch = rr
    rr.size = new vec2(VIEWER_W - 7, VIEWER_H - 10)
    rr.cornerRadius = 0.9
    rr.backgroundColor = KIND_ACCENT.image
    rr.opacity = 0.45
    this.freeIcon(c, ICON_IMAGE, 4.0, KIND_ACCENT.image, new vec3(0, 0, 0.08))
    return c
  }

  private buildViewerVideo(root: SceneObject): SceneObject {
    const c = this.viewerBody(root, "BodyVideo")
    const screen = this.obj(c, "Screen", new vec3(0, 0.9, 0))
    const rr = screen.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    rr.size = new vec2(VIEWER_W - 7, VIEWER_H - 12)
    rr.cornerRadius = 0.9
    rr.backgroundColor = KIND_ACCENT.video
    rr.opacity = 0.22
    this.freeIcon(c, ICON_VIDEO, 4.4, KIND_ACCENT.video, new vec3(0, 0.9, 0.08))

    const track = VIEWER_W - 9
    this.plate(c, new vec2(track, 0.42), KIND_ACCENT.video, 0.21, new vec3(0, -4.6, 0.08), 0.28)
    this.plate(
      c,
      new vec2(track * 0.38, 0.42),
      KIND_ACCENT.video,
      0.21,
      new vec3(-track * 0.31, -4.6, 0.1),
      0.95
    )
    return c
  }

  private buildViewerAudio(root: SceneObject): SceneObject {
    const c = this.viewerBody(root, "BodyAudio")
    this.freeIcon(c, ICON_AUDIO, 3.6, KIND_ACCENT.audio, new vec3(0, 3.4, 0.08))

    // A long waveform reads as "this is a recording" far better than a bar chart.
    const bars = 29
    const step = (VIEWER_W - 9) / (bars - 1)
    for (let i = 0; i < bars; i++) {
      const phase = Math.sin(i * 0.9) * 0.5 + Math.sin(i * 0.31) * 0.5
      const hgt = 0.7 + Math.abs(phase) * 4.4
      this.plate(
        c,
        new vec2(0.34, hgt),
        KIND_ACCENT.audio,
        0.17,
        new vec3(-(VIEWER_W - 9) / 2 + i * step, -0.6, 0.08),
        i < bars * 0.38 ? 0.95 : 0.4
      )
    }

    const track = VIEWER_W - 9
    this.plate(c, new vec2(track, 0.42), KIND_ACCENT.audio, 0.21, new vec3(0, -4.6, 0.08), 0.28)
    this.plate(
      c,
      new vec2(track * 0.38, 0.42),
      KIND_ACCENT.audio,
      0.21,
      new vec3(-track * 0.31, -4.6, 0.1),
      0.95
    )
    return c
  }

  private freeIcon(
    parent: SceneObject,
    texture: Texture,
    sizeCM: number,
    tint: vec4,
    pos: vec3
  ): void {
    const so = this.obj(parent, "Icon", pos)
    const img = so.createComponent("Component.Image") as Image
    const mat = imageMaterial.clone() // CLONE — never share across textures
    mat.mainPass.baseTex = texture
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
    img.clearMaterials()
    img.addMaterial(mat)
    img.mainPass.baseColor = tint
    so.getTransform().setLocalScale(new vec3(sizeCM, sizeCM, 1))
  }

  private toggleViewer(item: ContentHandles): void {
    if (this.viewerItem === item) {
      this.viewerItem = null
      return
    }
    this.viewerItem = item
    // Launch from wherever the chip currently is, so the panel grows out of the
    // file rather than fading in somewhere unrelated.
    this.viewerFrom = item.root.getTransform().getLocalPosition()
    this.populateViewer(item.def)
    this._onFileOpened.invoke(item.def.name)
  }

  private populateViewer(def: ContentDef): void {
    const v = this.viewer
    if (v === null) return
    v.title.text = def.name
    v.sub.text = KIND_LABEL[def.kind] + " · " + def.meta

    const kinds: ContentKind[] = ["text", "image", "video", "audio"]
    for (const k of kinds) {
      v.bodies[k].enabled = k === def.kind
    }

    if (def.kind === "text") {
      const body = def.body ?? []
      for (let i = 0; i < v.lines.length; i++) {
        v.lines[i].text = i < body.length ? body[i] : ""
      }
    }
  }

  private updateViewer(dt: number): void {
    const v = this.viewer
    if (v === null) return

    const target = this.viewerItem !== null ? 1 : 0
    this.viewerT += (target - this.viewerT) * Math.min(1, dt * VIEWER_SPEED)

    if (this.viewerT < 0.006 && target === 0) {
      if (v.root.enabled) v.root.enabled = false
      return
    }
    if (!v.root.enabled) v.root.enabled = true

    const e = easeOutCubic(clamp01(this.viewerT))
    const from = this.viewerFrom

    const toX = Math.max(-VIEWER_MAX_X, Math.min(VIEWER_MAX_X, from.x))
    const toY = from.y + VIEWER_BACK_OFFSET

    const tr = v.root.getTransform()
    tr.setLocalPosition(
      new vec3(
        from.x + (toX - from.x) * e,
        from.y + (toY - from.y) * e,
        from.z + (VIEWER_HEIGHT - from.z) * e
      )
    )

    // Flat on the desk at launch, standing upright once open — the panel rises
    // out of the file and tips up to face the reader.
    const tilt = ((VIEWER_TILT_DEG * Math.PI) / 180) * e
    tr.setLocalRotation(quat.angleAxis(tilt, new vec3(1, 0, 0)))

    const sc = VIEWER_START_SCALE + (1 - VIEWER_START_SCALE) * e
    tr.setLocalScale(new vec3(sc, sc, 1))
  }

  private buildContents(parent: SceneObject, card: CardHandles): void {
    const defs = CONTENTS[card.def.id] ?? []
    const n = defs.length
    for (let i = 0; i < n; i++) {
      const def = defs[i]
      const angle = ((CONTENT_RING_START_DEG + (360 / n) * i) * Math.PI) / 180
      // Built before the chip so the hierarchy DFS paints it underneath.
      const tetherObj = this.obj(parent, "Tether_" + def.name)
      const tether = tetherObj.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
      tether.size = new vec2(1, TETHER_WIDTH) // stretched by scale, never resized
      tether.cornerRadius = TETHER_WIDTH / 2
      tether.backgroundColor = new vec4(0.6, 0.75, 0.85, 1)
      tether.opacity = 0
      tetherObj.enabled = false

      const root = this.obj(parent, "Content_" + card.def.id + "_" + def.name)
      const manipOut: InteractableManipulation[] = []
      const refs: {nameText: Text | null; thumb: RoundedRectangle | null} = {
        nameText: null,
        thumb: null
      }
      // Cloned, never shared: cloud content rewrites name/meta/body per chip and
      // must not mutate the module-level sample list.
      const ownDef: ContentDef = {
        kind: def.kind,
        name: def.name,
        meta: def.meta,
        body: def.body === undefined ? undefined : def.body.slice(),
        reserve: def.reserve
      }
      const btn = this.buildContentCard(root, ownDef, manipOut, refs)
      root.enabled = false
      const item: ContentHandles = {
        def: ownDef,
        root,
        angle,
        delay: CONTENT_START_DELAY + i * CONTENT_STAGGER,
        hovered: false,
        grabbed: false,
        interactive: false,
        hoverAmount: 0,
        restX: 0,
        restY: 0,
        pinned: false,
        ownerId: card.def.id,
        grouped: true,
        offsetX: 0,
        offsetY: 0,
        p: 0,
        tether,
        tetherObj,
        nameText: refs.nameText as Text,
        thumb: refs.thumb,
        grabStartX: 0,
        grabStartY: 0,
        dragged: false,
        settleT: 1,
        settleFromX: 0,
        settleFromY: 0,
        settleToX: 0,
        settleToY: 0,
        snapPending: false
      }
      card.contents.push(item)
      this.bindContent(item, btn, manipOut[0])

      if (def.reserve === true) {
        item.delay = Number.MAX_VALUE
        item.def.name = ""
        if (item.nameText) item.nameText.text = ""
      }
    }
    this.reflowRing(card)
    this.refreshOpenDuration(card)
  }

  /**
   * Spread whatever is actually on the ring evenly around it.
   *
   * Angles cannot be fixed at build time once the pool holds reserves and cloud
   * files that may not seat — a fixed angle leaves a hole in the ring wherever
   * an unused chip would have been. Recomputing over the enabled chips keeps
   * the ring even however many files the folder ends up holding.
   */
  private reflowRing(card: CardHandles): void {
    const live: ContentHandles[] = []
    for (const chip of card.contents) {
      if (chip.delay < Number.MAX_VALUE) live.push(chip)
    }
    const n = live.length
    if (n === 0) return
    for (let i = 0; i < n; i++) {
      live[i].angle = ((CONTENT_RING_START_DEG + (360 / n) * i) * Math.PI) / 180
      live[i].delay = CONTENT_START_DELAY + i * CONTENT_STAGGER
    }
  }

  /** One mock content chip. Silhouette, accent and body treatment all differ per kind. */
  private buildContentCard(
    root: SceneObject,
    def: ContentDef,
    out: InteractableManipulation[],
    refs: {nameText: Text | null; thumb: RoundedRectangle | null}
  ): Button {
    const size = KIND_SIZE[def.kind]
    const accent = KIND_ACCENT[def.kind]
    const w = size.x
    const h = size.y

    // A Button rather than a bare RoundedRectangle, for the same reason the
    // folder cards are: chips are disabled whenever their folder is closed, and
    // a bare SIK Interactable never re-registers after that.
    const btn = root.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(w, h, 1) // BEFORE init

    // Files rearrange across the desk just like folders do.
    const manip = root.createComponent(
      InteractableManipulation.getTypeName()
    ) as InteractableManipulation
    manip.setCanTranslate(true)
    manip.setCanRotate(false)
    manip.setCanScale(false)

    const iconObj = this.obj(root, "Icon", new vec3(0, h / 2 - 1.5, 0.08))
    const img = iconObj.createComponent("Component.Image") as Image
    const mat = imageMaterial.clone() // CLONE — never share across textures
    mat.mainPass.baseTex = KIND_ICON[def.kind]
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
    img.clearMaterials()
    img.addMaterial(mat)
    img.mainPass.baseColor = accent
    iconObj.getTransform().setLocalScale(new vec3(2.2, 2.2, 1))

    if (def.kind === "text") {
      // Ruled lines, last one short — reads as a page of prose.
      for (let i = 0; i < 3; i++) {
        const lw = i === 2 ? w * 0.34 : w * 0.58
        this.plate(root, new vec2(lw, 0.32), accent, 0.16, new vec3(0, 0.3 - i * 0.95, 0.06), 0.7)
      }
    } else if (def.kind === "image") {
      // Stands in for a thumbnail until a real one is downloaded into it.
      refs.thumb = this.plate(
        root,
        new vec2(w * 0.7, h * 0.32),
        accent,
        0.5,
        new vec3(0, -0.1, 0.06),
        0.5
      )
    } else if (def.kind === "video") {
      // Scrub track with a played portion.
      const track = w * 0.66
      this.plate(root, new vec2(track, 0.38), accent, 0.19, new vec3(0, -h * 0.1, 0.06), 0.26)
      this.plate(
        root,
        new vec2(track * 0.42, 0.38),
        accent,
        0.19,
        new vec3(-track * 0.29, -h * 0.1, 0.07),
        0.95
      )
    } else {
      // Waveform bars.
      // Shorter bars, nudged up: the audio chip is the shortest of the four, so
      // a full-height waveform ran straight through its name label.
      const heights = [0.56, 1.19, 1.75, 0.84, 1.47, 0.7, 0.42]
      for (let i = 0; i < heights.length; i++) {
        this.plate(
          root,
          new vec2(0.32, heights[i]),
          accent,
          0.16,
          new vec3((i - 3) * 0.72, 0.15, 0.06),
          0.9
        )
      }
    }

    const nameObj = this.obj(root, "Name", new vec3(0, -h / 2 + 1.0, 0.08))
    const t = nameObj.createComponent("Component.Text") as Text
    t.text = def.name
    t.depthTest = true
    applyTextRole(t, "Caption", DESK_DIST)
    t.textFill.color = COLOR_PRIMARY
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    const tw = textWidthCm(def.name, "Caption", DESK_DIST)
    t.layoutRect = Rect.create(-tw / 2, tw / 2, -0.8, 0.8)
    refs.nameText = t

    out.push(manip)
    return btn
  }

  private bindContent(
    item: ContentHandles,
    btn: Button,
    manip: InteractableManipulation
  ): void {
    const bind = (): void => {
      manip.onManipulationStart.add(() => {
        const cur = item.root.getTransform().getLocalPosition()
        item.grabbed = true
        item.dragged = false
        item.grabStartX = cur.x
        item.grabStartY = cur.y
        item.settleT = 1 // a new grab cancels any settle in progress
      })
      manip.onManipulationEnd.add(() => {
        item.grabbed = false
        item.snapPending = true
      })

      btn.onHoverEnter.add(() => {
        // A chip still flying out of the folder is not a target yet.
        if (!item.interactive) return
        item.hovered = true
        this._onFileHover.invoke(item.def.name)
      })
      btn.onHoverExit.add(() => {
        item.hovered = false
      })
      btn.onTriggerUp.add(() => {
        // Repositioning a file must not also open it.
        if (!item.interactive || item.dragged) return
        this.toggleViewer(item)
      })
    }
    if (this.started) bind()
    else this.createEvent("OnStartEvent").bind(bind)
  }

  private plate(
    parent: SceneObject,
    size: vec2,
    color: vec4,
    corner: number,
    pos: vec3,
    opacity: number
  ): RoundedRectangle {
    const so = this.obj(parent, "Plate", pos)
    const rr = so.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    rr.size = size
    rr.cornerRadius = corner
    rr.backgroundColor = color
    rr.opacity = opacity
    return rr
  }

  /**
   * One independently draggable folder.
   *
   * Deliberately NOT a UIKit Button. A Button owns its own visual state machine
   * and auto-converts to a toggle, which fights the hover / grabbed / released
   * feedback this card has to show. Building straight on the SIK primitives
   * keeps every state under this module's control.
   */
  private addFolder(
    parent: SceneObject,
    def: FolderDef,
    home: vec3,
    glow: RoundedRectangle,
    glowObj: SceneObject
  ): void {
    const card = this.obj(parent, "Card_" + def.id, home)

    // A UIKit Button, not a bare RoundedRectangle + Interactable. The desk is
    // hidden until it is placed, and a bare SIK Interactable does NOT survive
    // its subtree being disabled — it never re-registers with the
    // InteractionManager, so the card renders but can never be hovered or
    // grabbed again. Button's Element lifecycle re-initializes on enable, which
    // is exactly the property this card needs. Everything visual below is still
    // driven by updateFolders(); the Button is here for its lifecycle.
    const btn = card.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(CARD_W, CARD_H, 1) // BEFORE init
    btn.setIsToggleable(true) // persistent "selected" visual state

    // Grab-and-move layered on the Button's own Interactable.
    const manip = card.createComponent(
      InteractableManipulation.getTypeName()
    ) as InteractableManipulation
    manip.setCanTranslate(true)
    // Rotation and scale stay off: the card must stay parallel to the desk, and
    // updateFolders() re-asserts that every frame regardless.
    manip.setCanRotate(false)
    manip.setCanScale(false)

    // Card face content: icon over title over subtitle.
    const inner = this.obj(card, "CardInner", new vec3(0, 0, CARD_CONTENT_Z))
    const stack = inner.createComponent(FlexLayout.getTypeName()) as FlexLayout
    stack.direction = FlexDirection.Column
    stack.justifyContent = FlexJustify.Center
    stack.alignItems = FlexAlign.Stretch
    stack.rowGap = 0.55
    stack.width = CARD_W
    stack.height = CARD_H
    stack.paddingTop = 0.8
    stack.paddingBottom = 0.8
    stack.paddingLeft = 0.6
    stack.paddingRight = 0.6

    // R3: children parent to `inner` (the SceneObject), never to the layout.
    void stack

    // Collected via an array rather than a `let`: TypeScript cannot see that the
    // builder callback runs synchronously, so a plain variable stays typed null.
    const iconSlot: Image[] = []
    this.flexChild(inner, {w: CARD_W - 1.2, h: 3.6}, (iconRowObj) => {
      const iconRow = this.flexRow(iconRowObj, CARD_W - 1.2, 3.6, {
        justify: FlexJustify.Center,
        align: FlexAlign.Center
      })
      iconSlot.push(this.addIcon(iconRow, def.icon, 3.0, COLOR_ACCENT))
    })

    this.addColumnText(inner, def.title, "Headline2", COLOR_PRIMARY, 2.2)
    this.addColumnText(inner, def.subtitle, "Caption", COLOR_SECONDARY, 1.6)

    // The lid hinges about the card's far edge: the pivot sits on that edge and
    // the plate hangs back from it, so rotating the pivot about local X swings
    // the plate up and away like the cover of a folder. It sits just BEHIND the
    // card face while closed, so the resting card looks exactly as before.
    const lidPivot = this.obj(card, "LidPivot", new vec3(0, CARD_H / 2, LID_Z))
    const lidPlate = this.obj(lidPivot, "LidPlate", new vec3(0, -CARD_H / 2, 0))
    const lid = lidPlate.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    lid.size = new vec2(CARD_W, CARD_H)
    lid.cornerRadius = CARD_CORNER
    lid.backgroundColor = LID_FILL

    const handles: CardHandles = {
      def,
      root: card,
      adoptGlow: 0,
      settleT: 1,
      settleFromX: home.x,
      settleFromY: home.y,
      settleToX: home.x,
      settleToY: home.y,
      snapPending: false,
      openTime: 0,
      openDuration: CONTENT_ITEM_DUR,
      lidPivot,
      icon: iconSlot[0],
      iconIsOpen: false,
      contents: [],
      button: btn,
      glow,
      glowObj,
      hovered: false,
      grabbed: false,
      selected: false,
      lift: 0,
      scale: SCALE_REST,
      grabStartX: home.x,
      grabStartY: home.y,
      dragged: false
    }
    this.cards.push(handles)

    // SIK subscriptions must not run before SIK is ready. Folders can be built
    // either during onAwake or lazily after the desk is shown, so bind now when
    // we are already past OnStart, and defer otherwise.
    if (this.started) {
      this.bindFolder(handles, btn, manip)
    } else {
      this.createEvent("OnStartEvent").bind(() => this.bindFolder(handles, btn, manip))
    }
  }

  private bindFolder(
    handles: CardHandles,
    btn: Button,
    manip: InteractableManipulation
  ): void {
    const def = handles.def
    const card = handles.root

    btn.onHoverEnter.add(() => {
      handles.hovered = true
      this._onFolderHoverEnter.invoke(def.id)
    })
    btn.onHoverExit.add(() => {
      handles.hovered = false
    })

    manip.onManipulationStart.add(() => {
      const p = card.getTransform().getLocalPosition()
      handles.grabbed = true
      handles.settleT = 1 // a new grab cancels any settle in progress
      handles.dragged = false
      handles.grabStartX = p.x
      handles.grabStartY = p.y
      this._onFolderGrabbed.invoke(def.id)
    })
    manip.onManipulationEnd.add(() => {
      handles.grabbed = false
      handles.snapPending = true
      this._onFolderReleased.invoke(def.id)
    })

    // Select only on a pinch that never became a drag — otherwise every
    // reposition would also toggle selection.
    btn.onTriggerUp.add(() => {
      if (!handles.dragged) this._onFolderSelected.invoke(def.id)
    })
  }

  /**
   * Per-frame folder constraint and visual state.
   *
   * InteractableManipulation translates in WORLD space, so a dragged card would
   * otherwise drift off the desk plane and inherit whatever tilt the hand had.
   * The mat's local frame IS the surface frame (local +Z is the surface normal),
   * so pinning local Z and clearing local rotation keeps every card flat on the
   * physical surface no matter how it was moved.
   */
  private updateFolders(): void {
    const dt = getDeltaTime()
    this.hoveredItem = null
    this.resolvePendingSnaps()
    const adoptId = this.adoptCandidate()
    const kLift = Math.min(1, dt * CARD_LIFT_SPEED)
    const kScale = Math.min(1, dt * CARD_SCALE_SPEED)

    for (const card of this.cards) {
      const tr = card.root.getTransform()
      const p = tr.getLocalPosition()

      // Keep the whole card on the mat and clear of the header strip.
      let x = Math.max(-CARD_BOUND_X, Math.min(CARD_BOUND_X, p.x))
      let y = Math.max(CARD_BOUND_Y_MIN, Math.min(CARD_BOUND_Y_MAX, p.y))

      if (card.settleT < 1) {
        card.settleT = Math.min(1, card.settleT + dt / SETTLE_DUR)
        const se = easeOutCubic(card.settleT)
        x = card.settleFromX + (card.settleToX - card.settleFromX) * se
        y = card.settleFromY + (card.settleToY - card.settleFromY) * se
      }

      let wantLift = 0
      if (card.grabbed) wantLift = LIFT_GRABBED
      else if (card.hovered) wantLift = LIFT_HOVER
      else if (card.selected) wantLift = LIFT_OPEN

      let wantScale = SCALE_REST
      if (card.grabbed) wantScale = SCALE_GRABBED
      else if (card.hovered) wantScale = SCALE_HOVER

      card.lift += (wantLift - card.lift) * kLift
      card.scale += (wantScale - card.scale) * kScale

      tr.setLocalPosition(new vec3(x, y, CARD_BASE_Z + card.lift))
      tr.setLocalRotation(quat.quatIdentity())
      tr.setLocalScale(new vec3(card.scale, card.scale, 1))

      // Once a grab has travelled far enough it is a reposition, not a tap.
      if (card.grabbed && !card.dragged) {
        const moved = Math.abs(x - card.grabStartX) + Math.abs(y - card.grabStartY)
        if (moved > DRAG_SELECT_THRESHOLD) card.dragged = true
      }

      // Glow stays down on the mat and brightens/spreads as the card rises.
      // The folder that would claim a dragged file lights up as though lifted,
      // so the drop target is legible before the user commits to it.
      card.adoptGlow +=
        ((card.def.id === adoptId ? 1 : 0) - card.adoptGlow) * Math.min(1, dt * ADOPT_GLOW_SPEED)

      const t = Math.max(card.adoptGlow, Math.min(1, card.lift / LIFT_GRABBED))
      const spread = 1 + (GLOW_MAX_SPREAD_CM / CARD_W) * t
      const sh = card.glowObj.getTransform()
      sh.setLocalPosition(new vec3(x, y, GLOW_Z))
      sh.setLocalScale(new vec3(spread, spread, 1))
      card.glow.opacity = t

      this.updateOpenState(card, dt, x, y)
    }

    // A viewer whose file has retreated into a closing folder has nothing left
    // to belong to, so it closes with it.
    if (this.viewerItem !== null && !this.viewerItem.interactive) {
      this.viewerItem = null
    }

    this.updatePreview(dt)
    this.updateViewer(dt)
  }

  /**
   * Tidy up whatever was just released.
   *
   * Two passes. First align to a near neighbour's axis, so objects dropped
   * roughly in a row end up actually in a row. Then push out of any overlap,
   * along whichever axis needs the least travel, so nothing is ever left
   * sitting on top of something else. Separation is iterated because resolving
   * against one neighbour can push an object into a third.
   *
   * The result is handed to a short glide rather than applied instantly —
   * snapping you can watch happen is snapping you can predict.
   */
  private resolvePendingSnaps(): void {
    let anyPending = false
    for (const card of this.cards) {
      if (card.snapPending) anyPending = true
      for (const it of card.contents) {
        if (it.snapPending) anyPending = true
      }
    }
    if (!anyPending) return

    const items: DeskItem[] = []
    for (const card of this.cards) {
      const p = card.root.getTransform().getLocalPosition()
      items.push({x: p.x, y: p.y, w: CARD_W, h: CARD_H, key: "F:" + card.def.id})
      for (const it of card.contents) {
        if (!it.interactive) continue
        const sz = KIND_SIZE[it.def.kind]
        items.push({x: it.restX, y: it.restY, w: sz.x, h: sz.y, key: "C:" + it.def.name})
      }
    }

    for (const card of this.cards) {
      if (!card.snapPending) continue
      card.snapPending = false
      const p = card.root.getTransform().getLocalPosition()
      const target = this.snapTarget(
        {x: p.x, y: p.y, w: CARD_W, h: CARD_H, key: "F:" + card.def.id},
        items
      )
      card.settleFromX = p.x
      card.settleFromY = p.y
      card.settleToX = target.x
      card.settleToY = target.y
      card.settleT = 0
    }

    // Collected first: adoption moves files between folders' content lists, so
    // the lists must not be mutated while being walked.
    const pending: {item: ContentHandles; from: CardHandles}[] = []
    for (const card of this.cards) {
      for (const it of card.contents) {
        if (it.snapPending) pending.push({item: it, from: card})
      }
    }

    for (const entry of pending) {
      const it = entry.item
      it.snapPending = false
      const sz = KIND_SIZE[it.def.kind]
      const target = this.snapTarget(
        {x: it.restX, y: it.restY, w: sz.x, h: sz.y, key: "C:" + it.def.name},
        items
      )
      it.settleFromX = it.restX
      it.settleFromY = it.restY
      it.settleToX = target.x
      it.settleToY = target.y
      it.settleT = 0

      // Whichever folder it landed nearest to claims it — that is how a file is
      // moved from one folder to another. Dropped clear of every folder, it
      // keeps its current owner but stops travelling with it.
      const claimant = this.claimFor(it, target.x, target.y)
      if (claimant === null) {
        it.grouped = false
        continue
      }
      it.grouped = true
      const cp = claimant.root.getTransform().getLocalPosition()
      it.offsetX = target.x - cp.x
      it.offsetY = target.y - cp.y

      if (claimant.def.id !== it.ownerId) {
        const idx = entry.from.contents.indexOf(it)
        if (idx >= 0) entry.from.contents.splice(idx, 1)
        claimant.contents.push(it)
        it.ownerId = claimant.def.id
        // Both folders' open clocks are sized from their file count, so they
        // have to be re-derived — otherwise a folder that gains a file never
        // runs its clock far enough for that file to finish emerging, and the
        // file stays permanently mid-flight and uninteractable.
        this.refreshOpenDuration(entry.from)
        this.refreshOpenDuration(claimant)
        this._onFileRegrouped.invoke(it.def.name + " → " + claimant.def.id)
      }
    }
  }

  private refreshOpenDuration(card: CardHandles): void {
    let maxDelay = 0
    for (const it of card.contents) {
      // Parked chips carry MAX_VALUE; counting them would make the folder's
      // clock unreachable and every file would stay mid-emergence forever.
      if (it.delay === Number.MAX_VALUE) continue
      if (it.delay > maxDelay) maxDelay = it.delay
    }
    card.openDuration = maxDelay + CONTENT_ITEM_DUR
  }

  /**
   * Which folder should own this file if released at (x, y).
   *
   * Nearest folder wins, except that the current owner keeps the file unless a
   * rival is clearly closer — see ADOPT_HYSTERESIS.
   */
  private claimFor(item: ContentHandles, x: number, y: number): CardHandles | null {
    const best = this.nearestFolder(x, y)
    if (best === null) return null
    if (best.def.id === item.ownerId) return best

    const current = this.cardById(item.ownerId)
    if (current !== null) {
      const cp = current.root.getTransform().getLocalPosition()
      const dx = x - cp.x
      const dy = y - cp.y
      const dCurrent = Math.sqrt(dx * dx + dy * dy)
      const bp = best.root.getTransform().getLocalPosition()
      const bdx = x - bp.x
      const bdy = y - bp.y
      const dBest = Math.sqrt(bdx * bdx + bdy * bdy)
      if (dCurrent < ADOPT_RADIUS && dCurrent - dBest < ADOPT_HYSTERESIS) return current
    }
    return best
  }

  private cardById(id: string): CardHandles | null {
    for (const card of this.cards) {
      if (card.def.id === id) return card
    }
    return null
  }

  /** Nearest folder within ADOPT_RADIUS of a mat-local point, or null. */
  private nearestFolder(x: number, y: number): CardHandles | null {
    let best: CardHandles | null = null
    let bestDist = ADOPT_RADIUS
    for (const card of this.cards) {
      const p = card.root.getTransform().getLocalPosition()
      const dx = x - p.x
      const dy = y - p.y
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < bestDist) {
        bestDist = d
        best = card
      }
    }
    return best
  }

  /** The folder that would claim the file currently being dragged, if any. */
  private adoptCandidate(): string | null {
    for (const card of this.cards) {
      for (const it of card.contents) {
        if (!it.grabbed) continue
        const claimant = this.claimFor(it, it.restX, it.restY)
        return claimant === null ? null : claimant.def.id
      }
    }
    return null
  }

  private snapTarget(a: DeskItem, all: DeskItem[]): {x: number; y: number} {
    let tx = a.x
    let ty = a.y

    let bestDx = SNAP_ALIGN_DIST
    let bestDy = SNAP_ALIGN_DIST
    let alignX = 0
    let alignY = 0
    for (const b of all) {
      if (b.key === a.key) continue
      const dx = Math.abs(b.x - a.x)
      if (dx < bestDx) {
        bestDx = dx
        alignX = b.x - a.x
      }
      const dy = Math.abs(b.y - a.y)
      if (dy < bestDy) {
        bestDy = dy
        alignY = b.y - a.y
      }
    }
    tx += alignX
    ty += alignY

    for (let iter = 0; iter < SNAP_ITERATIONS; iter++) {
      let moved = false
      for (const b of all) {
        if (b.key === a.key) continue
        const overlapX = (a.w + b.w) / 2 + SNAP_MIN_GAP - Math.abs(tx - b.x)
        const overlapY = (a.h + b.h) / 2 + SNAP_MIN_GAP - Math.abs(ty - b.y)
        if (overlapX <= 0 || overlapY <= 0) continue
        if (overlapX < overlapY) {
          tx += tx >= b.x ? overlapX : -overlapX
        } else {
          ty += ty >= b.y ? overlapY : -overlapY
        }
        moved = true
      }
      if (!moved) break
    }

    const b = boundsFor(a.w, a.h)
    return {
      x: Math.max(-b.x, Math.min(b.x, tx)),
      y: Math.max(b.yMin, Math.min(b.yMax, ty))
    }
  }

  /**
   * Drive one folder's open/close animation.
   *
   * A single clock (`openTime`) runs forward while the folder is selected and
   * backward when it is not, so closing replays the whole thing in reverse for
   * free. The lid reads off the front of that clock; each content chip reads off
   * it with a per-item delay, which is what staggers them out of the folder
   * instead of having them all appear at once.
   */
  private updateOpenState(card: CardHandles, dt: number, x: number, y: number): void {
    card.openTime += card.selected ? dt : -dt
    if (card.openTime < 0) card.openTime = 0
    if (card.openTime > card.openDuration) card.openTime = card.openDuration

    // Lid hinge — leads the contents so the folder is already open when they emerge.
    const lidP = clamp01(card.openTime / LID_DUR)
    const lidRad = ((-LID_OPEN_DEG * Math.PI) / 180) * lidP
    card.lidPivot.getTransform().setLocalRotation(quat.angleAxis(lidRad, new vec3(1, 0, 0)))

    // Swap the folder glyph once per transition, not every frame.
    const shouldBeOpen = card.openTime > 0.001
    if (shouldBeOpen !== card.iconIsOpen) {
      card.iconIsOpen = shouldBeOpen
      card.icon.mainPass.baseTex = shouldBeOpen ? ICON_FOLDER_OPEN : card.def.icon
    }

    for (const item of card.contents) {
      // Rate-limited rather than read straight off the clock: when a file
      // changes owner its progress would otherwise jump, and a file filed into
      // a closed folder would vanish instantly instead of retracting into it.
      const pTarget = clamp01((card.openTime - item.delay) / CONTENT_ITEM_DUR)
      const maxStep = dt / CONTENT_ITEM_DUR
      const dp = pTarget - item.p
      item.p += Math.max(-maxStep, Math.min(maxStep, dp))
      const p = item.p

      if (p <= 0) {
        if (item.root.enabled) item.root.enabled = false
        if (item.tetherObj.enabled) item.tetherObj.enabled = false
        continue
      }
      if (!item.root.enabled) item.root.enabled = true

      const eOut = easeOutBack(p) // travel: overshoot the target, then settle back
      const eRise = easeOutCubic(p) // height, scale and tilt: decelerating

      // Where this chip belongs once settled. A grab overrides it, a settle
      // glides it, and otherwise it tracks its folder's ring slot — unless the
      // user has pinned it somewhere by moving it.
      if (item.grabbed) {
        const cur = item.root.getTransform().getLocalPosition()
        const sz = KIND_SIZE[item.def.kind]
        const b = boundsFor(sz.x, sz.y)
        item.restX = Math.max(-b.x, Math.min(b.x, cur.x))
        item.restY = Math.max(b.yMin, Math.min(b.yMax, cur.y))
        item.pinned = true
        if (!item.dragged) {
          const moved =
            Math.abs(item.restX - item.grabStartX) + Math.abs(item.restY - item.grabStartY)
          if (moved > DRAG_SELECT_THRESHOLD) item.dragged = true
        }
      } else if (item.settleT < 1) {
        item.settleT = Math.min(1, item.settleT + dt / SETTLE_DUR)
        const se = easeOutCubic(item.settleT)
        item.restX = item.settleFromX + (item.settleToX - item.settleFromX) * se
        item.restY = item.settleFromY + (item.settleToY - item.settleFromY) * se
      } else if (!item.pinned) {
        item.restX = x + Math.cos(item.angle) * CONTENT_RING_RADIUS
        item.restY = y + Math.sin(item.angle) * CONTENT_RING_RADIUS
      } else if (item.grouped) {
        // Placed by hand but still part of the folder: hold the offset it was
        // dropped at, so the whole cluster travels together.
        item.restX = x + item.offsetX
        item.restY = y + item.offsetY
      }
      // else: pinned and loose — restX/restY are absolute and nothing moves it.

      // Flight runs from the folder's mouth to wherever the chip belongs, so a
      // pinned file still flies home to its own spot rather than to a ring slot.
      const mouthX = x
      const mouthY = y + CONTENT_ORIGIN_Y
      let dirX = item.restX - mouthX
      let dirY = item.restY - mouthY
      const travel = Math.sqrt(dirX * dirX + dirY * dirY)
      if (travel > 0.001) {
        dirX /= travel
        dirY /= travel
      } else {
        dirX = Math.cos(item.angle)
        dirY = Math.sin(item.angle)
      }

      // Parabolic hop: the chip rises PAST its resting height mid-flight and
      // comes back down onto it. Lifted out and set down, not slid along a rail.
      const rise = CONTENT_START_Z + (CONTENT_LIFT - CONTENT_START_Z) * eRise
      const hop = CONTENT_ARC_HEIGHT * Math.sin(Math.PI * p)

      const tr = item.root.getTransform()
      const px = mouthX + (item.restX - mouthX) * eOut
      const py = mouthY + (item.restY - mouthY) * eOut
      tr.setLocalPosition(
        new vec3(px, py, rise + hop + CONTENT_HOVER_LIFT * item.hoverAmount)
      )

      // A line back to the owning folder — the visible form of "these belong
      // together". Faded in only once the file has nearly arrived, so it does
      // not whip around during the emergence arc.
      const tetherFade = clamp01((p - 0.6) / 0.4)
      if (item.grouped && tetherFade > 0.01) {
        if (!item.tetherObj.enabled) item.tetherObj.enabled = true
        const tdx = px - x
        const tdy = py - y
        const dist = Math.sqrt(tdx * tdx + tdy * tdy)
        const ttr = item.tetherObj.getTransform()
        ttr.setLocalPosition(new vec3(x + tdx * 0.5, y + tdy * 0.5, TETHER_Z))
        ttr.setLocalRotation(quat.angleAxis(Math.atan2(tdy, tdx), new vec3(0, 0, 1)))
        ttr.setLocalScale(new vec3(Math.max(0.1, dist - TETHER_INSET), 1, 1))
        item.tether.opacity = TETHER_OPACITY * tetherFade
      } else if (item.tetherObj.enabled) {
        item.tetherObj.enabled = false
      }

      // A chip only becomes a target once it has fully settled.
      item.interactive = p >= 1
      if (!item.interactive) item.hovered = false

      if (item.hovered) this.hoveredItem = item

      const hoverK = Math.min(1, dt * CONTENT_HOVER_SPEED)
      item.hoverAmount += ((item.hovered ? 1 : 0) - item.hoverAmount) * hoverK

      const sc =
        (CONTENT_START_SCALE + (1 - CONTENT_START_SCALE) * eRise) *
        (1 + (CONTENT_HOVER_SCALE - 1) * item.hoverAmount)
      tr.setLocalScale(new vec3(sc, sc, 1))

      // Tip from on-edge to flat about the axis perpendicular to travel, so the
      // chip lays itself down along the direction it is moving.
      const tilt = ((CONTENT_START_TILT_DEG * Math.PI) / 180) * (1 - eRise)
      tr.setLocalRotation(quat.angleAxis(tilt, new vec3(-dirY, dirX, 0)))
    }
  }

  // ── Layout Composition helpers ────────────────────────────────────────────

  private obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
    const sceneObject = global.scene.createSceneObject(name)
    sceneObject.setParent(parent)
    if (position) sceneObject.getTransform().setLocalPosition(position)
    return sceneObject
  }

  private liftInZ(sceneObject: SceneObject, zOffset: number): void {
    const transform = sceneObject.getTransform()
    const pos = transform.getLocalPosition()
    transform.setLocalPosition(new vec3(pos.x, pos.y, pos.z + zOffset))
  }

  private flexRow(
    parent: SceneObject,
    width: number,
    height: number,
    opts?: {gap?: number; padY?: number; padX?: number; justify?: FlexJustify; align?: FlexAlign}
  ): SceneObject {
    return this.makeFlex(parent, FlexDirection.Row, width, height, opts)
  }

  private makeFlex(
    parent: SceneObject,
    direction: FlexDirection,
    width: number,
    height: number,
    opts?: {gap?: number; padY?: number; padX?: number; justify?: FlexJustify; align?: FlexAlign}
  ): SceneObject {
    const container = this.obj(parent, "Flex")
    this.liftInZ(container, LAYOUT_Z_LIFT)
    const flexLayout = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
    const flexItem = container.createComponent(FlexItem.getTypeName()) as FlexItem
    if (width > 0) flexItem.overrideWidth = width
    if (height > 0) flexItem.overrideHeight = height

    flexLayout.onInitialized.add(() => {
      flexLayout.width = width
      flexLayout.height = height
      flexLayout.direction = direction
      if (direction === FlexDirection.Row) {
        flexLayout.columnGap = opts?.gap ?? 0
      } else {
        flexLayout.rowGap = opts?.gap ?? 0
      }
      flexLayout.paddingTop = opts?.padY ?? 0
      flexLayout.paddingBottom = opts?.padY ?? 0
      flexLayout.paddingLeft = opts?.padX ?? 0
      flexLayout.paddingRight = opts?.padX ?? 0
      flexLayout.justifyContent = opts?.justify ?? FlexJustify.Start
      flexLayout.alignItems = opts?.align ?? FlexAlign.Stretch
    })
    return container
  }

  private flexChild(
    parent: SceneObject,
    size: {w?: number; h?: number; grow?: number},
    builder: (childObject: SceneObject) => void
  ): SceneObject {
    const child = this.obj(parent, "Item")
    this.liftInZ(child, LAYOUT_Z_LIFT)
    const flexItem = child.createComponent(FlexItem.getTypeName()) as FlexItem
    if (size.w !== undefined && size.w > 0) flexItem.overrideWidth = size.w
    if (size.h !== undefined && size.h > 0) flexItem.overrideHeight = size.h
    flexItem.flexGrow = size.grow ?? 0
    flexItem.flexShrink = 0

    builder(child)

    // NOTE: do NOT call parentFlexLayout.addItems([flexItem]) here. UIKit 2.0
    // defaults FlexLayout.autoDiscoverItemsOnStart = true, which discovers every
    // direct-child FlexItem during OnStart — and addItems() THROWS when called
    // before the layout is initialized while that flag is on. Since this whole
    // tree is built in onAwake, auto-discovery is the correct (and only) path.
    return child
  }

  // ── Content helpers ───────────────────────────────────────────────────────

  /** Text inside a ROW that has siblings — needs a real layoutRect (patterns Option A). */
  private addRowText(
    parent: SceneObject,
    text: string,
    role: TextRole,
    color: vec4,
    widthCM?: number
  ): Text {
    const so = this.obj(parent, "RowText")
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyTextRole(t, role, DESK_DIST)
    t.textFill.color = color
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    const w = widthCM ?? textWidthCm(text, role, DESK_DIST)
    t.layoutRect = Rect.create(-w / 2, w / 2, -1.2, 1.2)
    so.createComponent(FlexItem.getTypeName())
    return t
  }

  /** Text inside a COLUMN — Stretch fills the cross-axis (width), so centering works. */
  private addColumnText(
    parent: SceneObject,
    text: string,
    role: TextRole,
    color: vec4,
    height: number
  ): Text {
    const so = this.obj(parent, "ColText")
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyTextRole(t, role, DESK_DIST)
    t.textFill.color = color
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-0.5, 0.5, -0.5, 0.5)
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    item.alignSelf = FlexAlignSelf.Stretch
    item.overrideHeight = height
    // Auto-discovered at OnStart — see the note in flexChild().
    return t
  }

  private addIcon(parent: SceneObject, texture: Texture, sizeCM: number, tint: vec4): Image {
    const so = this.obj(parent, "Icon")
    const img = so.createComponent("Component.Image") as Image
    const mat = imageMaterial.clone() // CLONE — never share across textures
    mat.mainPass.baseTex = texture
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false // Images: test ON, write OFF
    img.clearMaterials()
    img.addMaterial(mat)
    img.mainPass.baseColor = tint
    // ImageHandler reads localScale as size.
    so.getTransform().setLocalScale(new vec3(sizeCM, sizeCM, 1))
    so.createComponent(FlexItem.getTypeName())
    return img
  }
}
