# Selected prompts — DeskOS

The narrative account of the workflow is in [PROMPT-LOG.md](PROMPT-LOG.md). This
file is the raw material behind it: the actual prompts that moved the project.

DeskOS took **70 prompts** across four sessions (12, 14, 15 and 16 August 2026).
Reproducing all seventy would bury the useful ones, so this is a selection of
**17** — the prompts that set direction, and the handful of debugging exchanges
that produced the findings in the log.

Prompts written in English appear verbatim, typos included. The session was
worked in a mix of English and Dutch; where the original was Dutch it is
translated and marked **[translated]**. Nothing has been rewritten to look
better in hindsight.

---

## 1. Building it — 12 August

Nine prompts took the project from nothing to a working spatial file system.
They are deliberately scoped one capability at a time, and each one ends by
naming the quality bar rather than the implementation.

> Build a SPECS spatial desktop prototype called DeskOS. Place a set of flat
> folder cards on detected real-world horizontal surfaces using World Query. The
> folders should remain anchored to the physical surface. Use the Spectacles
> Interaction Kit for hand interaction. Start with three folders: Projects,
> Photos and Personal. Do not implement file contents yet. Focus on reliable
> spatial placement, interaction and visual hierarchy.

> Test the folder placement and hand interaction. Identify any issues with
> surface placement, interaction targeting, anchoring or object movement. Fix
> those issues and retest.

> Now we have 1 panel/ui but we need seperate folders we can move.. then add
> direct-pinch dragging to DeskOS each folder. Users should be able to pinch a
> folder, move it across the detected desk surface, and release it. The folder
> should maintain its orientation parallel to the surface. Add clear visual
> feedback for hover, grabbed and released states.

> Implement an animated folder-opening interaction. When the user taps a folder,
> the folder should visually open and its contents should emerge from the folder
> and arrange themselves spatially around it. Create mock content for text
> files, images, videos and audio recordings. Each content type should have a
> distinct visual representation.

> Refine the folder opening animation so that the files feel physically
> connected to the folder. Avoid simply replacing the folder with a grid. Files
> should visibly emerge from the folder and settle into spatial positions.

The refinement prompt above is the one that produced the emergence motion still
used in the demo. The first version replaced the folder with a grid, which is
what a flat file browser would do; naming the failure mode rather than the fix
was what changed it.

> Add interaction states for files. Hovering over a file should provide visual
> feedback and a small preview. Tapping a file should open an appropriate
> spatial viewer based on its type: image viewer, text document, video player or
> audio player.

> Allow users to freely rearrange folders and files across the desk. Objects
> should remain anchored to the real-world surface after being moved. Add subtle
> snapping and settling behavior when an object is released near another object.

> Add a spatial grouping behavior. When files are moved close to their parent
> folder, make them visually associate with that folder. When the folder is
> moved, its associated files should optionally move with it. And make sure the
> user is able to move files from/to different (parent) folders!

> Okay now we need to connect it all to a supabase/snapcloud project so we can
> actually see/save images/docs/voice notes etc etc instead of just mock data!

---

## 2. The prompt that changed the project — 14 August

Everything above is a competent file browser. This is the prompt that decided it
was not enough.

> **[translated]** OK, the lens is already quite nice, but I'm entering this
> hackathon (week 1): lenslist.co/clad-summer-hackathon — and obviously I want
> to win, so how do we best approach this? (note: there are already several
> people with a lens like the one we've built now.. maybe we should add a killer
> USP)

The answer was to stop competing on execution inside a crowded category. What
followed — vision capture, AI filing, voice — came out of that reframing, and so
did the positioning line in the description: *others built a file browser you
can put on your desk; DeskOS is a desk that understands what you put on it.*

The feature that carries the demo was specified in one messy paragraph, mixed in
with three unrelated complaints:

> **[translated]** Hmm, when I take a photo of the desk (with the notes) I don't
> see any of the 3D objects in the photo? Only the Lens Studio grid..?! And it
> might be nice to have a 3-2-1 countdown before taking a photo so I can look at
> the notes (and the idea is that from the photo the lens can put the notes
> (appointments) into a text file/agenda).. I don't see that yet either. Also
> the DeskOS UI can be a bit bigger, right now the folders and text are hard to
> read. (Not too big, it all still has to fit on the 3D desk..) Oh, and I just
> noticed the text is usually not visible on the UI? Only when I rotate it (the
> camera) to a specific angle does the text appear — but it's only a small angle
> where it's visible.. maybe the text falls behind the UI/buttons etc?!

Four separate problems in one message: a broken capture path, a missing feature,
a legibility complaint, and — last and phrased as an afterthought — the render
bug that would take four wrong diagnoses to find.

---

## 3. Debugging

Six exchanges, each tied to a finding in [PROMPT-LOG.md](PROMPT-LOG.md).

**The agent broke the build and did not notice.** A preview-interaction tool
auto-installed two packages built against a newer Lens Studio and corrupted the
project. The user caught it, not the agent:

> There is no 'AiPreviewAgentInteract' in the assets?

→ log §7, *Two bugs that were the agent's own*

**A "device-only" limit that was a checkbox.** Microphone capture was assumed
to be unavailable in Preview. It was not:

> **[translated]** `[DeskOSCapture] Captured 54341 samples in 55 frames at
> 16000 Hz.` Works! (mic was muted in LS)

→ log §1, *Three "device-only" limitations were configuration*

**A bug that only exists the second time.** The first voice command worked, so
the session-lifecycle bug stayed hidden until it was used twice:

> **[translated]** Hmm, after the first time it doesn't work any more:
> `[DeskOSVoice] Transcription error: 1`

→ an ASR session left open poisons the next one; see `DeskOSVoice.ts`

**A room you cannot stand in.** The demo room anchored to the camera pose on
frame one, before the preview camera had settled:

> **[translated]** The room is too high — I can't move up in the preview so I
> can't get 'into' the room.

→ log §3, *The preview camera starts somewhere you did not ask for*

**The observation that ended four wrong diagnoses.** The invisible-text bug
survived four reasoned explanations. None of them was right. What ended it was
this — the user isolating the variable by hand:

> **[translated]** Still the same. If I turn the 'DemoRoom' off visually then
> everything is fine, but with it on the text is gone.. (except when I look left
> or right..)

→ log §5, *Four wrong diagnoses, and what actually ended it*

**Dead code that type-checks, compiles and runs.** The same complaint, five
times, about a corner radius that never changed. The user was right every time:
the property was inert after build, so every assignment to it was doing nothing.

> **[translated]** Still exactly the same BG.. fix the border-radius of the BG
> please!!

→ log §6, *Dead code that type-checks, compiles and runs*

---

## What the selection leaves out

Mostly repetition. The invisible-text bug alone accounts for six near-identical
messages — *still the same*, *still exactly the same*, *still the same problem* —
and only the last one, quoted above, carried new information. That ratio is the
honest shape of the work: a small number of prompts that set direction, and a
long tail of a user telling an agent that its confident explanation was still
wrong.
