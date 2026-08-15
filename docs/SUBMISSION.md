# DeskOS — submission

**Repo:** https://github.com/bgeuze/DeskOS
**Prompt log:** [docs/PROMPT-LOG.md](PROMPT-LOG.md)
**Built with:** Lens Studio 5.22, target SPECS 27, CLAD (Claude Code + the Lens Studio MCP)

---

## Description

Others built a file browser you can put on your desk. DeskOS is a desk that
understands what you put on it.

You place it on a real surface and it stays there. Then you fill it three ways:
look at something and pinch, speak to it, or move things with your hands.

The capture is the point. Point at a sticky note and pinch, and you do not get a
photo of a sticky note — you get a text file, with the appointment transcribed
into bullets, already filed in the folder it belongs to, and one line telling you
why it went there. A photo of a whiteboard becomes readable notes. A photo of an
object stays a photo. The model decides what the thing should *become*, not just
what to call it.

Say "open my photos", "put that with my project stuff", or "tidy up my desk" and
it rearranges itself — one file at a time, so you can follow where everything
went instead of being shown a new layout. Drag something to the bin and it comes
apart and is gone, from the desk and from the cloud.

Everything persists in Snap Cloud: folders, files, and the media itself.

---

## What is real

Built and verified in Lens Studio Preview: surface placement, camera capture and
AI filing, voice commands, tidy, recording and playback of voice memos, deletion,
and cloud persistence.

Not verified on hardware. The 2024 Spectacles cannot run a SPECS 27 build, so
this was developed against measurements taken from the running Lens rather than
from a device — which turned out to be the more interesting constraint. Three
subsystems that appeared to be device-only were configuration; the display FOV
that decides the whole layout is a number we had to read out of the runtime
rather than choose. Those measurements are in the prompt log.
