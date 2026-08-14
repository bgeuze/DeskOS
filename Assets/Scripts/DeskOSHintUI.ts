import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {
  FlexAlign,
  FlexAlignSelf,
  FlexDirection,
  FlexJustify
} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"

// ── Assets ───────────────────────────────────────────────────────────────────
const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material

const ICON_SEARCHING = requireAsset("../Icons/my_location.png") as Texture
const ICON_READY = requireAsset("../Icons/check_circle.png") as Texture

// ── Typography (see DeskOSUI.ts for the full rationale) ──────────────────────
const FONT_SIZE_SCALE = 1.0

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

// ── Layout constants (cm) ────────────────────────────────────────────────────
const PANEL_W = 30
const PANEL_H = 9.5
const PAD = 1.6
const INNER_W = PANEL_W - PAD * 2

// The main script parks this card ~90 cm in front of the user during placement.
const HINT_DIST = 90

const LAYOUT_Z_LIFT = 0.02

const COLOR_PRIMARY = new vec4(1, 1, 1, 1)
const COLOR_SECONDARY = new vec4(1, 1, 1, 0.6)
const COLOR_ACCENT = new vec4(0.35, 0.85, 0.92, 1)
const COLOR_READY = new vec4(0.45, 0.9, 0.55, 1)

/**
 * DeskOS placement hint — a small card that faces the user while they are
 * choosing a surface. Positioned and billboarded by DeskOS.ts.
 *
 * This panel starts VISIBLE (placement is the Lens's opening state), so it has
 * no start-hidden init hazard; it is only ever disabled after OnStart.
 */
@component
export class DeskOSHintUI extends BaseScriptComponent {
  private headlineText: Text | null = null
  private detailText: Text | null = null
  private iconImage: Image | null = null

  private started = false
  private wantVisible = true

  onAwake(): void {
    this.buildUI()
    this.createEvent("OnStartEvent").bind(() => {
      this.started = true
      this.sceneObject.enabled = this.wantVisible
    })
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Show/hide the hint. Safe before OnStart (deferred via wantVisible). */
  setPanelVisible(visible: boolean): void {
    this.wantVisible = visible
    if (this.started) this.sceneObject.enabled = visible
  }

  /**
   * Drive the placement message.
   * @param ready true once a valid horizontal surface is under the cursor.
   */
  setHint(headline: string, detail: string, ready: boolean): void {
    if (this.headlineText) {
      this.headlineText.text = headline
      this.headlineText.textFill.color = ready ? COLOR_READY : COLOR_PRIMARY
    }
    if (this.detailText) this.detailText.text = detail
    if (this.iconImage) {
      this.iconImage.mainPass.baseTex = ready ? ICON_READY : ICON_SEARCHING
      this.iconImage.mainPass.baseColor = ready ? COLOR_READY : COLOR_ACCENT
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  private buildUI(): void {
    this.sceneObject.createComponent("Component.Canvas")

    const plate = this.sceneObject.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.size = new vec2(PANEL_W, PANEL_H)

    const content = this.obj(this.sceneObject, "Content", new vec3(0, 0, 0.6))
    const col = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    col.width = PANEL_W
    col.height = PANEL_H
    col.direction = FlexDirection.Column
    col.alignItems = FlexAlign.Stretch
    col.justifyContent = FlexJustify.Center
    col.rowGap = 0.7
    col.paddingTop = PAD
    col.paddingBottom = PAD
    col.paddingLeft = PAD
    col.paddingRight = PAD

    // Row 1 — status glyph + headline.
    this.flexChild(content, {w: INNER_W, h: 3.4}, (rowObj) => {
      const row = this.flexRow(rowObj, INNER_W, 3.4, {
        justify: FlexJustify.Center,
        align: FlexAlign.Center,
        gap: 0.9
      })
      this.iconImage = this.addIcon(row, ICON_SEARCHING, 2.4, COLOR_ACCENT)
      this.headlineText = this.addRowText(row, "Find a flat surface", "Headline2", COLOR_PRIMARY, 18)
    })

    // Row 2 — instruction detail.
    this.detailText = this.addColumnText(
      content,
      "Look at a table or desk, then pinch to place DeskOS",
      "Caption",
      COLOR_SECONDARY,
      2.2
    )
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
    const container = this.obj(parent, "Flex")
    this.liftInZ(container, LAYOUT_Z_LIFT)
    const flexLayout = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
    const flexItem = container.createComponent(FlexItem.getTypeName()) as FlexItem
    if (width > 0) flexItem.overrideWidth = width
    if (height > 0) flexItem.overrideHeight = height

    flexLayout.onInitialized.add(() => {
      flexLayout.width = width
      flexLayout.height = height
      flexLayout.direction = FlexDirection.Row
      flexLayout.columnGap = opts?.gap ?? 0
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

    // NOTE: do NOT call parentFlexLayout.addItems(...) — UIKit 2.0 defaults
    // FlexLayout.autoDiscoverItemsOnStart = true and addItems() throws before
    // the layout initializes. Direct-child FlexItems are discovered at OnStart.
    return child
  }

  // ── Content helpers ───────────────────────────────────────────────────────

  private addRowText(
    parent: SceneObject,
    text: string,
    role: TextRole,
    color: vec4,
    widthCM: number
  ): Text {
    const so = this.obj(parent, "RowText")
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyTextRole(t, role, HINT_DIST)
    t.textFill.color = color
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.4, 1.4)
    so.createComponent(FlexItem.getTypeName())
    return t
  }

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
    applyTextRole(t, role, HINT_DIST)
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
    const mat = imageMaterial.clone()
    mat.mainPass.baseTex = texture
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
    img.clearMaterials()
    img.addMaterial(mat)
    img.mainPass.baseColor = tint
    so.getTransform().setLocalScale(new vec3(sizeCM, sizeCM, 1))
    so.createComponent(FlexItem.getTypeName())
    return img
  }
}
