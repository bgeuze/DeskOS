# DeskOS

**Others built a file browser you can put on your desk. DeskOS is a desk that understands what you put on it.**

A spatial desktop for Snap Spectacles. You place it on a real surface, and from then on it is a
working surface: folders you can drag, files that fly out when a folder opens, and three ways of
getting things onto it — look at something and pinch, speak, or reach out and move it by hand.

Built for the CLAD Summer Hackathon, week 1 — *Organize*.

---

## What it does

**Place it.** Look at a table. A reticle tracks the surface, tells you when it is not level, too
close, too far, or above you, and locks when it is happy. Pinch and the desk is anchored in the
world.

**Point at something and pinch.** The camera frame goes to Gemini, which decides three things: what
to call it, which folder it belongs in, and — the part that matters — *what it should become*. A
photo of a sticky note is not usefully a photo. It comes back as a text file with the appointment
transcribed into bullets, filed under the folder it belongs to, with one line explaining why.

**Talk to it.** Push to talk, say "open my photos" or "put that with my project stuff" or "tidy up
my desk". The sentence goes to a model that maps it onto the desk it can actually see, and every
folder and filename it returns is checked against the real desk before anything moves.

**"Tidy up my desk."** Every title and summary goes up, clusters come back, and the desk rearranges
itself with a stagger so it reads as tidying rather than as a re-layout.

Everything persists in Snap Cloud: folders, files, and the media itself.

---

## How it is built

~7,100 lines of TypeScript across 15 files.

| File | Lines | What it owns |
|---|---:|---|
| `DeskOSUI.ts` | 3019 | The whole panel: mat, header, folder cards, file chips, viewers, animation |
| `DeskOS.ts` | 970 | Orchestration and the placement state machine |
| `DeskOSCloud.ts` | 589 | Snap Cloud — tables, RLS, storage, media upload |
| `DeskOSBrain.ts` | 458 | Gemini: understanding a frame, an utterance, and a tidy plan |
| `PlacementReticle.ts` | 371 | Procedural reticle mesh and its states |
| `DeskOSCapture.ts` | 345 | Camera frames and voice memos |
| `DeskOSHintUI.ts` | 303 | The head-locked placement card |
| `DeskOSSurfacePlacer.ts` | 240 | WorldQuery hit testing and its editor stand-in |
| `DeskOSConfig.ts` | 219 | Tuning constants and the desk-anchor basis math |
| `DemoRoom.ts` / `DemoWorker.ts` | 383 | Preview-only set dressing (see below) |
| `DeskOSVoice.ts` | 113 | Push-to-talk ASR |
| others | ~200 | audio, async helpers, shared types |

Built on SpectaclesInteractionKit 0.18.0, SpectaclesUIKit, RemoteServiceGateway 2.0.0
(Gemini 2.5 Flash), the Supabase client for Snap Cloud, `AsrModule`, `CameraModule` and
`WorldQueryModule`. Lens Studio 5.22, target SPECS 27.

### The preview set

`DemoRoom` builds a 7 × 7 × 3 m room out of Asset Library furniture and switches itself off the
moment the Lens is not running in the editor — on hardware the real room is the room.

It is not decoration. The desk top sits at exactly the height `DeskOSSurfacePlacer` simulates in
preview, so the tray lands on a desk instead of in a void, and there are sticky notes on it with
real text on them so the capture pipeline has something to read.

---

## Built with CLAD

The interesting part of this project is not that a model wrote the code. It is what agent-driven
development found that would otherwise have shipped broken. A curated log lives in
[`docs/PROMPT-LOG.md`](docs/PROMPT-LOG.md), with the prompts behind it in
[`docs/PROMPTS.md`](docs/PROMPTS.md); the headlines:

**Three "device-only" limitations were configuration.** Networking, the camera and the microphone
were each behind an `isEditor()` guard written on the assumption that Preview could not reach them.
All three were wrong. The network one was a debug line — `HttpsOpenService for Wearable platform
only` — misread as an error; the HTTP request succeeds on the very next line. The camera one was
true of `requestImage` and false of the continuous stream. The microphone was muted in the Preview
panel. Every guard was replaced with a measurement.

**Measurement kept overturning plausible reasoning.** A five-second freeze after each capture was
"obviously" the JPEG encode. Measured: the encode takes 68 ms and the five seconds are the model
call. The fix was a two-phase capture, not a faster encode.

**The display FOV is 36.6°, and it is not yours to choose.** Set the camera to 78° and the runtime
still reports `0.63857` rad — SPECS 27 overrides it. That number decides where the tray has to be
placed for it to fit on screen at all.

**Four wrong diagnoses in a row on one bug.** Labels on the folder cards were invisible from most
angles. Depth test, draw order, coplanar geometry, surface clearance — each hypothesis was
plausible, each was argued from the code, and each was wrong. What solved it was rendering the card
in isolation and discovering the UI had never been broken at all: the user's own Bitmoji avatar was
loading with a mesh 186 km across and painting over everything behind it.

**`RoundedRectangle.cornerRadius` does nothing after the component is built.** Four different corner
formulas produced identical output because none of them ever reached the geometry.

---

## Running it

1. Lens Studio 5.22 or later, project target **SPECS 27**.
2. Preview panel: Device Type Override → **Specs**.
3. `RemoteServiceGatewayCredentials` needs a **Google** token for Gemini and a Snap token.
4. Snap Cloud: attach your own Supabase project. The schema is two tables (`desk_folders`,
   `desk_files`) with RLS scoped to `auth.uid()`, plus `image` and `audio` storage buckets.
5. Unmute the microphone in the Preview panel — it is off by default, and a muted mic looks
   exactly like a broken one.

The credentials file and the Supabase project descriptor are gitignored. Nothing in this history
contains a key.

---

## Known limitations

- Placement, capture, voice and tidy are all verified in Lens Studio Preview. They are not verified
  on hardware: the 2024 Spectacles cannot run a SPECS 27 build.
- File positions are not yet written back to the cloud, so a restart restores what is on the desk
  but not where you left it.
- The Bitmoji avatar is disabled. It loads with degenerate geometry; see the log.
- Seeded sample audio is a placeholder and its stated duration is wrong.
