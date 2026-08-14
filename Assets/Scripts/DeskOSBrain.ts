import {Gemini} from "RemoteServiceGateway.lspkg/HostedExternal/Gemini"
import {GeminiTypes} from "RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes"
import {ContentKind} from "./DeskOSTypes"
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
const MODEL = "gemini-2.0-flash"

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
  /**
   * Capture yields `text` or `image` only — a still frame cannot become a video
   * or a voice note. A photographed whiteboard is `text`: the interesting part
   * is what it *says*, so it becomes a readable document rather than a picture
   * of one.
   */
  kind: ContentKind
  folderSlug: string
  /** One short clause, shown under the card while it flies to its folder. */
  rationale: string
  /** Transcribed lines when kind is `text`; null for a plain photo. */
  body: string[] | null
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
    kind: {
      type: "STRING",
      enum: ["text", "image"],
      description:
        "'text' when readable writing is the point (whiteboard, page, screen, receipt, sign). " +
        "'image' when the subject is a thing, place or person."
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
    body: {
      type: "ARRAY",
      items: {type: "STRING"},
      description:
        "Only when kind is 'text': the readable content, one entry per line, in reading order. " +
        "Transcribe what is actually written. Omit entirely for images."
    }
  },
  required: ["title", "meta", "kind", "folderSlug", "rationale"]
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
      "Decide three things: what to call it, whether it is worth reading or worth " +
      "looking at, and which folder it belongs in.\n\n" +
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

    const kind: ContentKind = parsed.kind === "text" ? "text" : "image"

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

    // Documents get their transcription; photos never do, even if the model
    // volunteered one — a picture card with a body renders as neither.
    let body: string[] | null = null
    if (kind === "text" && Array.isArray(parsed.body)) {
      body = []
      for (const line of parsed.body) body.push(String(line))
      if (body.length === 0) body = null
    }

    return {
      title: this.text(parsed.title, "Untitled"),
      meta: this.text(parsed.meta, kind === "text" ? "Note" : "Photo"),
      kind,
      folderSlug: slug,
      rationale: this.text(parsed.rationale, "filed here for now"),
      body
    }
  }

  private text(value: any, fallback: string): string {
    if (value === undefined || value === null) return fallback
    const s = String(value).trim()
    return s.length === 0 ? fallback : s
  }
}
