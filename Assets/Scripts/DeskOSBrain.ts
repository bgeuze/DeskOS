import {Gemini} from "RemoteServiceGateway.lspkg/HostedExternal/Gemini"
import {GeminiTypes} from "RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes"
import {withTimeout} from "./DeskOSAsync"

/**
 * DeskOS — the part that understands what you put on the desk.
 *
 * Turns a camera frame into a filed document: what it is, what to call it, and
 * which folder it belongs in. Plain TypeScript, no @component — DeskOS.ts drives
 * it, and it knows nothing about the UI beyond the answer it hands back.
 *
 * Everything here resolves rather than throws. A desk that cannot reach Gemini
 * should still accept the capture; it just will not have a name for it yet.
 */

/**
 * Known-good through RSG's Vertex backend. Do not swap this for an `-exp` or
 * `-preview` id — those 404 through the gateway even though they are valid
 * against Google directly.
 */
const MODEL = "gemini-2.5-flash"

/** Understanding is a nicety, not the capture itself — never let it hang the pinch. */
const THINK_TIMEOUT_S = 12.0

/** A folder as the model is allowed to see it. */
export interface FolderChoice {
  slug: string
  title: string
  /** What already lives there, so filing goes by theme rather than by folder name. */
  examples: string[]
}

/** What the model decided about one captured frame. */
export interface Understanding {
  title: string
  meta: string
  folderSlug: string
  /** One short clause, shown under the card while it flies to its folder. */
  rationale: string
  /**
   * What the capture should BECOME on the desk.
   *
   * A photo of a sticky note is not usefully a photo. If the frame is mostly
   * writing, the useful artefact is the writing — so the model decides, and a
   * note comes back as "text" with `body` filled in.
   */
  kind: "text" | "image"
  /** Bullet lines, when kind is "text". Empty otherwise. */
  body: string[]
}

/**
 * Structured output, so the answer arrives already-shaped instead of being
 * scraped out of prose. This is the difference between a demo that works once
 * and one that survives a live run.
 */
const UNDERSTANDING_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: {
      type: "STRING",
      description: "Two to five words. A name a person would give this, not a description."
    },
    meta: {
      type: "STRING",
      description: "At most four words of detail, e.g. 'Handwritten note' or '3 action items'."
    },
    folderSlug: {
      type: "STRING",
      description: "Slug of the best-fitting existing folder. Must be one of the offered slugs."
    },
    rationale: {
      type: "STRING",
      description:
        "One clause, under ten words, addressed to the user, explaining the folder choice. " +
        "No leading capital, no full stop. Example: 'matches your other sprint notes'."
    },
    kind: {
      type: "STRING",
      enum: ["text", "image"],
      description:
        "'text' when the frame is mostly writing worth keeping as writing — a sticky note, " +
        "a whiteboard, a page, a receipt, a hand-drawn list. 'image' for anything else."
    },
    body: {
      type: "ARRAY",
      items: {type: "STRING"},
      description:
        "Only when kind is 'text'. The content transcribed as short bullet lines, one item " +
        "per line, at most six lines and at most eight words each. Keep dates, times, names " +
        "and amounts exactly as written. Empty array when kind is 'image'."
    }
  },
  required: ["title", "meta", "folderSlug", "rationale", "kind", "body"]
}

/** What the user asked the desk to do. */
export interface DeskIntent {
  action: "open" | "close" | "file" | "find" | "tidy" | "unknown"
  /** Target folder for open/file. */
  folderSlug: string | null
  /** Target file for file/find. */
  fileName: string | null
  /** Short line to show back, in the user's own terms. */
  say: string
}

const INTENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    action: {
      type: "STRING",
      enum: ["open", "close", "file", "find", "tidy", "unknown"],
      description:
        "'open' show a folder's contents. 'close' put the open folder away. " +
        "'file' move a specific file into a folder. 'find' locate and open a file. " +
        "'tidy' reorganise the whole desk. 'unknown' if it is none of these."
    },
    folderSlug: {type: "STRING", description: "Target folder slug, when one is meant."},
    fileName: {
      type: "STRING",
      description: "Exact name of the file being referred to, copied from the list given."
    },
    say: {
      type: "STRING",
      description:
        "Under six words, confirming what is about to happen, in plain language. " +
        "Example: 'opening Projects'. If the action is unknown, say what was not understood."
    }
  },
  required: ["action", "say"]
}

export class DeskOSBrain {
  /**
   * Look at one frame and decide what it is and where it goes.
   *
   * `jpegBase64` is the frame already base64-encoded — the same encoding the
   * upload path needs, so the texture is only encoded once per capture.
   */
  async understand(
    jpegBase64: string,
    folders: FolderChoice[]
  ): Promise<Understanding | null> {
    if (folders.length === 0) return null

    const request: GeminiTypes.Models.GenerateContentRequest = {
      model: MODEL,
      type: "generateContent",
      body: {
        systemInstruction: {
          role: "user",
          parts: [{text: this.instruction(folders)}]
        },
        contents: [
          {
            role: "user",
            parts: [
              {text: "Sort this onto my desk."},
              {inlineData: {mimeType: "image/jpeg", data: jpegBase64}}
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: UNDERSTANDING_SCHEMA,
          // Filing is a judgement call with one right-ish answer, not a
          // creative task; low temperature keeps repeat captures consistent.
          temperature: 0.2,
          maxOutputTokens: 800
        }
      }
    }

    try {
      const response = await withTimeout(Gemini.models(request), THINK_TIMEOUT_S)
      if (response === null) {
        print("[DeskOSBrain] Gemini did not answer within " + THINK_TIMEOUT_S + "s.")
        return null
      }
      return this.parse(response, folders)
    } catch (e) {
      print("[DeskOSBrain] Gemini call failed: " + e)
      return null
    }
  }

  private instruction(folders: FolderChoice[]): string {
    const lines: string[] = []
    for (const folder of folders) {
      const has =
        folder.examples.length === 0
          ? "empty"
          : "currently holds: " + folder.examples.join(", ")
      lines.push('- "' + folder.slug + '" (' + folder.title + ") — " + has)
    }

    return (
      "You are the filing sense of a spatial desktop worn on AR glasses. The user " +
      "glances at something in the room and pinches; you receive that camera frame.\n\n" +
      "Decide what to call it, which folder it belongs in, and whether it is worth " +
      "keeping as a picture or as text. A sticky note, whiteboard or page is worth " +
      "keeping as TEXT: transcribe it into short bullet lines so the user has the " +
      "appointment, not a photograph of the appointment. Read " +
      "any writing in the frame — a whiteboard of sprint planning should be named " +
      "for what it says, not for being a whiteboard.\n\n" +
      "The folders that exist:\n" +
      lines.join("\n") +
      "\n\nFile by what the thing is about, not by matching words to folder names. " +
      "A photo of a whiteboard covered in project planning belongs with project work " +
      "even though nothing says 'project'.\n\n" +
      "folderSlug must be exactly one of the slugs above. If nothing fits well, pick " +
      "the least-bad one — the user can always move it, and a card that lands " +
      "somewhere is better than one that lands nowhere."
    )
  }

  private parse(response: any, folders: FolderChoice[]): Understanding | null {
    let raw: string
    try {
      raw = response.candidates[0].content.parts[0].text
    } catch (e) {
      print("[DeskOSBrain] Unexpected response shape: " + JSON.stringify(response))
      return null
    }

    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      print("[DeskOSBrain] Response was not JSON: " + raw)
      return null
    }

    // Never trust the slug. A hallucinated folder would file the card into a
    // folder that does not exist, and the card would simply vanish.
    let slug = String(parsed.folderSlug === undefined ? "" : parsed.folderSlug)
    let known = false
    for (const folder of folders) {
      if (folder.slug === slug) known = true
    }
    if (!known) {
      print("[DeskOSBrain] Unknown folder '" + slug + "' — falling back to " + folders[0].slug)
      slug = folders[0].slug
    }

    // A note transcribed into nothing is still a photo. Only promote to text
    // when there is actually text to show, or the desk gains an empty text card.
    const lines: string[] = []
    if (Array.isArray(parsed.body)) {
      for (const line of parsed.body) {
        const clean = String(line).trim()
        if (clean.length > 0) lines.push(clean)
      }
    }
    const wantsText = String(parsed.kind) === "text" && lines.length > 0

    return {
      title: this.text(parsed.title, "Untitled"),
      meta: this.text(parsed.meta, "Photo"),
      folderSlug: slug,
      rationale: this.text(parsed.rationale, "filed here for now"),
      kind: wantsText ? "text" : "image",
      body: wantsText ? lines : []
    }
  }

  private text(value: any, fallback: string): string {
    if (value === undefined || value === null) return fallback
    const s = String(value).trim()
    return s.length === 0 ? fallback : s
  }
}

/**
 * Turn a spoken sentence into something the desk can do.
 *
 * Separate from `understand` because the inputs are different in kind: this one
 * sees text and the current desk, never an image. Both go through a response
 * schema for the same reason — an intent scraped out of prose fails in a demo
 * exactly when it matters.
 */
export async function interpretUtterance(
  utterance: string,
  folders: FolderChoice[],
  files: {name: string; folderSlug: string}[]
): Promise<DeskIntent | null> {
  const folderLines: string[] = []
  for (const f of folders) folderLines.push('- "' + f.slug + '" (' + f.title + ")")

  const fileLines: string[] = []
  for (const f of files) fileLines.push('- "' + f.name + '" in ' + f.folderSlug)

  const instruction =
    "You are the command interpreter for a spatial desktop worn on AR glasses. " +
    "The user speaks; you decide which single action they meant.\n\n" +
    "Folders:\n" + folderLines.join("\n") + "\n\n" +
    "Files on the desk:\n" +
    (fileLines.length === 0 ? "(none)" : fileLines.join("\n")) +
    "\n\nMatch by meaning, not by exact words — \"put that with my work stuff\" means " +
    "file it under the work-ish folder. Copy fileName exactly from the list; never " +
    "invent one. Speech recognition is imperfect, so expect near-misses in names and " +
    "resolve them to the closest real entry. If nothing plausibly matches, answer " +
    "'unknown' rather than guessing an action the user did not ask for."

  const request: GeminiTypes.Models.GenerateContentRequest = {
    model: MODEL,
    type: "generateContent",
    body: {
      systemInstruction: {role: "user", parts: [{text: instruction}]},
      contents: [{role: "user", parts: [{text: utterance}]}],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: INTENT_SCHEMA,
        temperature: 0.1,
        maxOutputTokens: 300
      }
    }
  }

  try {
    const response = await withTimeout(Gemini.models(request), THINK_TIMEOUT_S)
    if (response === null) {
      print("[DeskOSBrain] Intent timed out.")
      return null
    }
    const raw = response.candidates[0].content.parts[0].text
    const parsed = JSON.parse(raw)

    // Trust nothing that names something: a hallucinated folder or file would
    // send the action somewhere that does not exist.
    let slug: string | null = parsed.folderSlug === undefined ? null : String(parsed.folderSlug)
    if (slug !== null) {
      let known = false
      for (const f of folders) if (f.slug === slug) known = true
      if (!known) slug = null
    }
    let file: string | null = parsed.fileName === undefined ? null : String(parsed.fileName)
    if (file !== null) {
      let known = false
      for (const f of files) if (f.name === file) known = true
      if (!known) file = null
    }

    return {
      action: parsed.action,
      folderSlug: slug,
      fileName: file,
      say: String(parsed.say === undefined ? "" : parsed.say)
    }
  } catch (e) {
    print("[DeskOSBrain] Intent failed: " + e)
    return null
  }
}

/** One file's new home, as decided by a desk-wide reorganise. */
export interface TidyMove {
  fileName: string
  folderSlug: string
}

const TIDY_SCHEMA = {
  type: "OBJECT",
  properties: {
    moves: {
      type: "ARRAY",
      description: "Every file on the desk, each with the folder it belongs in.",
      items: {
        type: "OBJECT",
        properties: {
          fileName: {type: "STRING", description: "Copied exactly from the list given."},
          folderSlug: {type: "STRING", description: "One of the offered folder slugs."}
        },
        required: ["fileName", "folderSlug"]
      }
    },
    say: {type: "STRING", description: "Under eight words describing what changed."}
  },
  required: ["moves", "say"]
}

/**
 * Re-file everything on the desk by what it is about.
 *
 * Returns only the files that should actually move. Filtering here rather than
 * in the caller keeps the animation honest: a file that is already where it
 * belongs should sit still, not fly out and land back in the same place.
 */
export async function planTidy(
  folders: FolderChoice[],
  files: {name: string; folderSlug: string}[]
): Promise<{moves: TidyMove[]; say: string} | null> {
  if (files.length === 0) return {moves: [], say: "nothing to tidy"}

  const folderLines: string[] = []
  for (const f of folders) folderLines.push('- "' + f.slug + '" (' + f.title + ")")

  const fileLines: string[] = []
  for (const f of files) fileLines.push('- "' + f.name + '" currently in ' + f.folderSlug)

  const instruction =
    "You are tidying a spatial desktop. Decide where every file belongs, by what " +
    "it is about rather than where it happens to sit now.\n\n" +
    "Folders:\n" + folderLines.join("\n") + "\n\n" +
    "Files:\n" + fileLines.join("\n") + "\n\n" +
    "Return an entry for every file, using its exact name and one of the folder " +
    "slugs above. Leaving a file where it is, is a valid and often correct answer — " +
    "a tidy desk is not one where everything moved."

  const request: GeminiTypes.Models.GenerateContentRequest = {
    model: MODEL,
    type: "generateContent",
    body: {
      systemInstruction: {role: "user", parts: [{text: instruction}]},
      contents: [{role: "user", parts: [{text: "Tidy my desk."}]}],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: TIDY_SCHEMA,
        temperature: 0.2,
        maxOutputTokens: 1200
      }
    }
  }

  try {
    const response = await withTimeout(Gemini.models(request), THINK_TIMEOUT_S)
    if (response === null) {
      print("[DeskOSBrain] Tidy timed out.")
      return null
    }
    const parsed = JSON.parse(response.candidates[0].content.parts[0].text)

    const moves: TidyMove[] = []
    const raw = Array.isArray(parsed.moves) ? parsed.moves : []
    for (const entry of raw) {
      const name = String(entry.fileName === undefined ? "" : entry.fileName)
      const slug = String(entry.folderSlug === undefined ? "" : entry.folderSlug)

      let current: string | null = null
      for (const f of files) if (f.name === name) current = f.folderSlug
      if (current === null) continue // never invented a file

      let knownFolder = false
      for (const f of folders) if (f.slug === slug) knownFolder = true
      if (!knownFolder) continue

      if (current === slug) continue // already home
      moves.push({fileName: name, folderSlug: slug})
    }

    return {moves, say: String(parsed.say === undefined ? "desk tidied" : parsed.say)}
  } catch (e) {
    print("[DeskOSBrain] Tidy failed: " + e)
    return null
  }
}
