# CLAD prompt log — DeskOS

A curated log, not a transcript. What follows is the handful of moments where agent-driven
development changed the outcome: what we believed, what the measurement said, and what changed
because of it.

The through-line is uncomfortable and worth stating up front: **the agent's reasoning was wrong far
more often than its measurements.** Every hour lost in this project was lost to a plausible
explanation argued from the code. Every hour saved came from stopping and instrumenting something.

---

## 1. Three "device-only" limitations were configuration

DeskOS begins with three subsystems that all appeared to be unavailable in Lens Studio Preview.
Each had an `isEditor()` guard in front of it. All three guards were wrong, and each was wrong in a
different way.

**Networking.** The Snap Cloud path was short-circuited in the editor on the strength of this log
line:

```
HttpsOpenService for Wearable platform only
```

Read as an error. It is a `D` — a debug line. The HTTP request succeeds on the line immediately
after it. The guard was replaced with an actual probe:

```
[DeskOSCloud] Backend reachable (HTTP 401)
```

401 is the expected answer from an unauthenticated health check. Preview had networking the whole
time.

**Camera.** True of `requestImage`, which is device-only. False of the continuous camera stream,
which runs in the editor. Rewriting capture around `requestCamera` + `copyFrame` made the feature
demonstrable *and* more responsive: the frame is already in hand when the user pinches instead of
being requested at that moment.

**Microphone.** Not a platform limitation at all. Muted in the Preview panel.

The pattern was general enough to become a rule for the rest of the project: *attempt it, and let
the platform refuse, so the log carries a real reason instead of ours.*

---

## 2. Measurement beats reasoning: the "hang"

> "Hmm op de een of andere manier lijkt de lens vast te lopen? wellicht bij het nemen van een foto ofzo?"
>
> *("Somehow the Lens seems to freeze? maybe when taking a photo or something?" — the prompts in this
> project were written in Dutch; this one is quoted verbatim because the diagnosis it triggered is
> the point.)*

The obvious suspect was the JPEG encode. It was instrumented rather than optimised:

```
[DeskOSCapture] Frame encoded in 68 ms (42 KB)
```

68 ms. The five seconds were the Gemini call. The fix was therefore not a faster encode but a
two-phase capture: the card lands immediately under a "Reading…" placeholder with the frozen frame
already on it, and is renamed and re-filed when the model answers. A desk that does nothing for five
seconds reads as broken; a desk that shows you what you just captured and then thinks does not.

The resolution change that came out of the same investigation was kept anyway — for power and heat,
which is the reason the typings actually give.

---

## 3. The preview camera starts somewhere you did not ask for

The preview set anchors itself around the camera. The first version did that on frame one and put
the floor 36 cm above the viewer's eye — a room you are standing under and cannot reach, because
preview height is not something you can drive.

Measured:

```
Camera Object worldPosition: (27.19, ~0.0, 167.40)
DemoRoom      worldPosition: (0, 150, 0)
```

World tracking reports `(0, 150, 0)` — a standing eye height above the tracking origin — *before*
the interactive preview applies its own pose. Anchoring now waits for the pose to stop changing,
with a hard cap so a camera being moved by hand still gets a room:

```
[DemoRoom] Set anchored at (-7.0, 0.0, 36.2) after 0.37s — floor 113.6 cm below the eye.
```

---

## 4. The display FOV is 36.6°, and it is not a setting

Asked to widen the view, the camera was set to 78°. The running Lens reports:

```
fov: 0.63857   // radians = 36.6°
```

SPECS 27 overrides it. The authored value is ignored, and the edit was reverted rather than left in
as a silent no-op.

That number is not trivia. The tray is 58 cm wide, so it only fits inside 36.6° from about 88 cm
away. Look down at 45° and the tray lands at 64 cm and overflows the display; look down at 30° and
it lands at 90 cm and fits. That is the difference between a demo where the UI is fully in frame and
one where the corners fall off, and it is derivable from one measured constant.

---

## 5. Four wrong diagnoses, and what actually ended it

The longest and most instructive failure. Labels on the folder cards were invisible from most
camera angles and appeared from a narrow one.

Four hypotheses, each argued from the source, each wrong:

1. **Depth test.** Text sat at local (0,0,0) of its backing card — exactly coplanar — with
   `depthTest = true`. Coplanar surfaces plus a depth test is a coin toss decided by viewing angle.
   Turning it off changed nothing.
2. **Draw order of the folder lid.** The lid was built after the card content, so it painted over
   it. Reordering it changed nothing.
3. **Layout separation.** Levels were stacked 0.02 cm apart — two tenths of a millimetre, inside
   the depth buffer's noise at a glancing angle. Raising it changed nothing.
4. **Surface clearance.** The tray floated 0.35 cm above a surface while the UI on it was thinner
   than that. Raising it to 2 cm changed nothing.

Fixes 2 and 3 were real bugs and were kept. None of them was *this* bug.

What ended it was giving up on argument and rendering the card by itself:

| Rendered | Result |
|---|---|
| the card alone | perfect — icon, title, subtitle |
| `Folders` alone | perfect — all three cards |
| `DeskOSUI` alone | perfect — the entire tray |
| everything | blank |

The UI had never been broken. Something outside it was drawing over it. Bisecting from there took
four more captures and landed on the user's own Bitmoji avatar:

```
body_GEO bounds
  min (-18,665,042,   560,025, -4,643,548)
  max (   -416,802, 13,760,025,  1,867,716)
```

A skinned mesh 186 kilometres across, invisible as a person and lethal as geometry, sweeping through
frame as the head turned. It sat inside the preview set, which is why disabling the set "fixed" it
and why every fix aimed at the UI could not.

**The lesson is not "check the avatar".** It is that four rounds of reasoning about code produced
four wrong answers, and the first attempt at direct observation produced the right one in one step.

---

## 6. Dead code that type-checks, compiles and runs

After the occlusion was fixed, the halo behind each folder card still had the wrong corners. Four
different corner-radius formulas were tried. All four produced *identical* output, which is the
tell:

`RoundedRectangle` bakes its corners into geometry when the component is built. `size` can be
changed afterwards. `cornerRadius` cannot. Every formula was being computed, assigned, and
discarded.

The fix was to stop asking the component and draw the shape — a generated PNG at the exact
dimensions, so the corner radius is a property of the artwork rather than a hope about an API.

---

## 7. Two bugs that were the agent's own

Honesty is cheap here and worth more than a clean narrative.

**A crash that presented as a UI freeze.** `audio.stop()` was called after disabling the viewer
root — and the AudioComponent lives on that root. The exception killed `updateFolders`, which runs
in `LateUpdate`, so every animation froze while buttons kept firing. It presented as "I can't close
the folder". Diagnosis came from a stack trace the user pasted, not from the ring-geometry analysis
that was underway at the time.

**Tap treated as drag.** `onManipulationEnd` set `snapPending` unconditionally, so tapping a file
ran the adopt path and handed it to a neighbouring folder. Gated on whether the pointer had actually
travelled.

---

## 8. What the workflow actually was

- `tsc --noEmit` as the fast loop — a full type-check without opening Lens Studio.
- `RecompileTypeScriptTool` then `RunAndCollectLogsTool` after every change. A compile that
  succeeds says nothing about whether the Lens runs.
- `QueryRuntimeSceneTool` and `CaptureRuntimeViewTool` for ground truth about the *running* scene,
  which is what finally settled the occlusion bug. The Scene panel shows authored transforms; the
  preview shows what is actually there, and they disagree whenever a script moves something.
- Secrets audited before the first commit and again before the repo went public: no JWT and no
  private key exists anywhere in the history.
