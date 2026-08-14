// DeskOS - PlacementReticle
//
// A flat, parametric surface-placement reticle generated at runtime with MeshBuilder.
// Geometry lies in the local XZ plane with a +Y normal, so the object's local up axis
// is the surface normal: point local +Y along a WorldQuery hit normal and the reticle
// hugs the physical surface.
//
// Structure (concentric radii + tick marks):
//   - outer ring band   : the 16 cm footprint boundary
//   - mid ring band     : secondary radius, reads as depth / hierarchy
//   - radial tick marks : every Nth tick is longer (cardinal), the "scanning" element
//   - centre dot        : the exact hit point
//
// States: Searching (off-white, ticks spin, breathing) -> Invalid (red, ticks stop)
//         -> Locked (cyan accent, one-shot outward pulse wave, ticks stop).
//
// Sizing is in Lens Studio world units (cm). Default outer radius 8 cm = 16 cm across.

export enum ReticleState {
  Searching = 0,
  Invalid = 1,
  Locked = 2,
}

const GROUP_OUTER = 0;
const GROUP_MID = 1;
const GROUP_DOT = 2;
const GROUP_TICK = 3;

const OUTER_BAND_IN = 0.918;
const OUTER_BAND_OUT = 1.0;
const MID_BAND_IN = 0.56;
const MID_BAND_OUT = 0.605;
const TICK_BAND_IN = 0.68;
const TICK_BAND_OUT = 0.87;
const TICK_CARDINAL_IN = 0.63;
const TICK_CARDINAL_OUT = 0.9;
const DOT_RADIUS = 0.105;

const OUTER_SEGMENTS = 72;
const MID_SEGMENTS = 56;
const DOT_SEGMENTS = 24;
const TICK_SEGMENTS = 2;
const TICK_SWEEP_DEG = 3.5;
const TICK_CARDINAL_SWEEP_DEG = 4.5;

const PULSE_DURATION = 0.55;
const TWO_PI = Math.PI * 2;

@component
export class PlacementReticle extends BaseScriptComponent {
  @input
  @hint("Vertex colour material (vertexBaseColorMaterial from the SimpleVertexBaseColor package).")
  material: Material;

  @input
  @hint("Outer radius in cm. 8 cm = 16 cm across.")
  outerRadius: number = 8.0;

  @input
  @hint("Animate tick spin, breathing and the lock pulse. Turn off to save frame time.")
  animate: boolean = true;

  @input("int")
  @hint("Number of radial tick marks around the ring.")
  tickCount: number = 12;

  @input("int")
  @hint("Every Nth tick is drawn longer as a cardinal mark.")
  cardinalEvery: number = 3;

  // --- runtime -------------------------------------------------------------
  private builder: MeshBuilder;
  private rmv: RenderMeshVisual;

  // Per-vertex template. Positions are regenerated from these each animated frame.
  private vRadius: number[] = [];
  private vAngle: number[] = [];
  private vGroup: number[] = [];
  private indices: number[] = [];
  private vertexCount: number = 0;

  // Vertices from dynamicStart..end are rewritten every animated frame (dot + ticks).
  // Everything before it is only rewritten on a state change or during a pulse.
  private dynamicStart: number = 0;

  private state: ReticleState = ReticleState.Searching;
  private tickSpin: number = 0;
  private radialScale: number = 1;
  private pulseStart: number = -100;
  private lastTime: number = 0;

  private scratch: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  onAwake(): void {
    this.rmv = this.sceneObject.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;

    this.builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3, normalized: true },
      { name: "color", components: 4 },
      { name: "texture0", components: 2 },
    ]);
    this.builder.topology = MeshTopology.Triangles;
    this.builder.indexType = MeshIndexType.UInt16;

    this.buildGeometry();

    this.rmv.mesh = this.builder.getMesh();
    if (this.material) {
      this.rmv.mainMaterial = this.material;
    } else {
      print("PlacementReticle: no material assigned - assign vertexBaseColorMaterial to the 'material' input.");
    }
    this.builder.updateMesh();

    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  // --- public API ----------------------------------------------------------

  /** Outer radius in cm - use it to size the footprint check in the placement script. */
  getRadius(): number {
    return this.outerRadius;
  }

  getState(): ReticleState {
    return this.state;
  }

  /** Off-white, ticks spinning: hunting for a valid horizontal surface. */
  setSearching(): void {
    this.setState(ReticleState.Searching);
  }

  /** Red, ticks frozen: a surface was hit but it failed the normal / size filter. */
  setInvalid(): void {
    this.setState(ReticleState.Invalid);
  }

  /** Cyan accent plus a one-shot outward pulse: surface accepted. */
  setLocked(): void {
    const changed = this.state !== ReticleState.Locked;
    this.setState(ReticleState.Locked);
    if (changed) this.pulse();
  }

  setState(state: ReticleState): void {
    if (this.state === state) return;
    this.state = state;
    this.writeAllVertices();
    this.builder.updateMesh();
  }

  /** Fire the outward pulse wave without changing state. */
  pulse(): void {
    this.pulseStart = getTime();
  }

  setVisible(visible: boolean): void {
    if (this.rmv) this.rmv.enabled = visible;
  }

  // --- geometry ------------------------------------------------------------

  private buildGeometry(): void {
    const R = this.outerRadius;
    const ticks = Math.max(0, Math.floor(this.tickCount));
    const cardinalEvery = Math.max(1, Math.floor(this.cardinalEvery));

    // Static section first, dynamic (dot + ticks) last so it forms a contiguous tail.
    this.addRing(R * OUTER_BAND_IN, R * OUTER_BAND_OUT, OUTER_SEGMENTS, GROUP_OUTER, 0, TWO_PI, true);
    this.addRing(R * MID_BAND_IN, R * MID_BAND_OUT, MID_SEGMENTS, GROUP_MID, 0, TWO_PI, true);

    this.dynamicStart = this.vertexCount;

    this.addDisc(R * DOT_RADIUS, DOT_SEGMENTS, GROUP_DOT);

    for (let i = 0; i < ticks; i++) {
      const cardinal = i % cardinalEvery === 0;
      const sweep = ((cardinal ? TICK_CARDINAL_SWEEP_DEG : TICK_SWEEP_DEG) * Math.PI) / 180;
      const centre = (TWO_PI * i) / ticks;
      const rIn = R * (cardinal ? TICK_CARDINAL_IN : TICK_BAND_IN);
      const rOut = R * (cardinal ? TICK_CARDINAL_OUT : TICK_BAND_OUT);
      this.addRing(rIn, rOut, TICK_SEGMENTS, GROUP_TICK, centre - sweep * 0.5, sweep, false);
    }

    // Emit the interleaved buffer in one shot, then the index buffer.
    const data: number[] = [];
    for (let i = 0; i < this.vertexCount; i++) {
      this.fillVertex(i, 0);
      for (let k = 0; k < 12; k++) data.push(this.scratch[k]);
    }
    this.builder.appendVerticesInterleaved(data);
    this.builder.appendIndices(this.indices);
  }

  /**
   * Annulus segment in the XZ plane. Vertices use x = r*sin(a), z = r*cos(a), so
   * increasing `a` traces counter-clockwise as seen from +Y. Winding
   * [innerA, outerA, outerB] + [innerA, outerB, innerB] therefore yields a +Y
   * facing normal, which is what back-face culling wants for a surface decal.
   */
  private addRing(
    rInner: number,
    rOuter: number,
    segments: number,
    group: number,
    angleStart: number,
    angleSweep: number,
    closed: boolean
  ): void {
    const base = this.vertexCount;
    const stations = closed ? segments : segments + 1;

    for (let i = 0; i < stations; i++) {
      const a = angleStart + (angleSweep * i) / segments;
      this.pushVertex(rInner, a, group);
      this.pushVertex(rOuter, a, group);
    }

    for (let i = 0; i < segments; i++) {
      const s0 = base + (i % stations) * 2;
      const s1 = base + ((i + 1) % stations) * 2;
      const innerA = s0;
      const outerA = s0 + 1;
      const innerB = s1;
      const outerB = s1 + 1;
      this.indices.push(innerA, outerA, outerB, innerA, outerB, innerB);
    }
  }

  /** Centre disc as a triangle list fan: [centre, rim_i, rim_i+1] is CCW from +Y. */
  private addDisc(radius: number, segments: number, group: number): void {
    const centre = this.vertexCount;
    this.pushVertex(0, 0, group);
    for (let i = 0; i < segments; i++) {
      this.pushVertex(radius, (TWO_PI * i) / segments, group);
    }
    for (let i = 0; i < segments; i++) {
      const a = centre + 1 + i;
      const b = centre + 1 + ((i + 1) % segments);
      this.indices.push(centre, a, b);
    }
  }

  private pushVertex(radius: number, angle: number, group: number): void {
    this.vRadius.push(radius);
    this.vAngle.push(angle);
    this.vGroup.push(group);
    this.vertexCount++;
  }

  // --- animation -----------------------------------------------------------

  private onUpdate(): void {
    if (!this.animate) return;

    const t = getTime();
    const dt = this.lastTime === 0 ? 0 : Math.min(0.1, t - this.lastTime);
    this.lastTime = t;

    // Ticks sweep while searching, freeze once a decision has been made.
    if (this.state === ReticleState.Searching) {
      this.tickSpin = (this.tickSpin + dt * 0.6) % TWO_PI;
    }

    const pulseT = (t - this.pulseStart) / PULSE_DURATION;
    const pulsing = pulseT >= 0 && pulseT <= 1;
    this.radialScale = pulsing ? 1 + 0.08 * Math.sin(Math.PI * pulseT) : 1;

    if (pulsing) {
      this.writeAllVertices();
    } else {
      // Steady state: only the dot + tick tail moves, so skip the static rings.
      for (let i = this.dynamicStart; i < this.vertexCount; i++) {
        this.fillVertex(i, t);
        this.builder.setVertexInterleaved(i, this.scratch);
      }
    }
    this.builder.updateMesh();
  }

  private writeAllVertices(): void {
    const t = getTime();
    for (let i = 0; i < this.vertexCount; i++) {
      this.fillVertex(i, t);
      this.builder.setVertexInterleaved(i, this.scratch);
    }
  }

  /** Writes one full interleaved vertex (pos3, normal3, colour4, uv2) into `scratch`. */
  private fillVertex(index: number, t: number): void {
    const group = this.vGroup[index];
    const spin = group === GROUP_TICK ? this.tickSpin : 0;
    const angle = this.vAngle[index] + spin;
    const radius = this.vRadius[index] * this.radialScale;

    const s = this.scratch;
    s[0] = Math.sin(angle) * radius;
    s[1] = 0;
    s[2] = Math.cos(angle) * radius;
    s[3] = 0;
    s[4] = 1;
    s[5] = 0;

    const r01 = this.outerRadius > 0 ? this.vRadius[index] / this.outerRadius : 0;
    this.fillColour(group, r01, t, s);

    s[10] = r01;
    s[11] = angle / TWO_PI;
  }

  private fillColour(group: number, r01: number, t: number, s: number[]): void {
    // Palette: matte off-white while searching, red on reject, cyan accent on lock.
    let cr: number;
    let cg: number;
    let cb: number;
    let ca: number;

    if (this.state === ReticleState.Locked) {
      cr = 0.25;
      cg = 0.88;
      cb = 0.98;
      ca = 0.95;
    } else if (this.state === ReticleState.Invalid) {
      cr = 0.95;
      cg = 0.35;
      cb = 0.3;
      ca = 0.8;
    } else {
      cr = 0.88;
      cg = 0.91;
      cb = 0.94;
      ca = 0.7;
    }

    // Hierarchy: the outer boundary reads strongest, the mid ring sits back.
    // Applied to RGB *and* alpha so the hierarchy survives an opaque blend mode -
    // vertexBaseColorMaterial ships with blendMode Disabled, which discards alpha.
    let dim = 1.0;
    if (group === GROUP_MID) dim = 0.45;
    else if (group === GROUP_TICK) dim = 0.85;

    // Breathing on the scanning elements only, so the static rings stay cheap.
    if (this.animate && this.state === ReticleState.Searching && (group === GROUP_TICK || group === GROUP_DOT)) {
      dim *= 0.7 + 0.3 * Math.sin(t * 2.2);
    }

    cr *= dim;
    cg *= dim;
    cb *= dim;
    ca *= dim;

    // One-shot pulse: a gaussian ring of brightness travelling outward.
    const pulseT = (t - this.pulseStart) / PULSE_DURATION;
    if (pulseT >= 0 && pulseT <= 1) {
      const d = (r01 - pulseT) * 6;
      const wave = Math.exp(-d * d);
      cr = Math.min(1, cr + wave * 0.9);
      cg = Math.min(1, cg + wave * 0.9);
      cb = Math.min(1, cb + wave * 0.9);
      ca = Math.min(1, ca * (1 + wave * 1.5));
    }

    s[6] = cr;
    s[7] = cg;
    s[8] = cb;
    s[9] = ca;
  }
}
