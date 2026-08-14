import {createClient, SupabaseClient} from "SupabaseClient.lspkg/supabase-snapcloud"

import {ContentKind} from "./DeskOSTypes"
import {withTimeout} from "./DeskOSAsync"

/**
 * DeskOS — Snap Cloud backing store.
 *
 * Plain TypeScript (no @component). Owns the Supabase client, sign-in, and the
 * read/write of desk state, so DeskOSUI never touches the network directly.
 *
 * Degrades on purpose: if no credentials have been imported yet — or sign-in
 * fails, or the device is offline — `load()` resolves with `null` and the UI
 * falls back to its built-in sample content. A Lens that cannot reach its
 * backend should still open on a working desk rather than an empty mat.
 */

const supabaseProject = requireAsset(
  "../SupabaseProject_DeskOS.supabaseProject"
) as SupabaseProject

/** Singleton, not an @input, so this module stays self-contained. */
const internetModule = require("LensStudio:InternetModule") as InternetModule

/** A reachable backend answers well inside this; an unreachable one never does. */
const PROBE_TIMEOUT_S = 4.0

/** One file as stored in `desk_files`. */
export interface CloudFile {
  id: string
  folderSlug: string
  kind: ContentKind
  name: string
  meta: string
  /** Documents only. */
  body: string[] | null
  /** Media only: object path inside the `deskos` bucket. */
  storagePath: string | null
  pinned: boolean
  grouped: boolean
  offsetX: number
  offsetY: number
  restX: number
  restY: number
}

export interface CloudFolder {
  id: string
  slug: string
  title: string
  subtitle: string
  posX: number
  posY: number
}

export interface CloudDesk {
  folders: CloudFolder[]
  files: CloudFile[]
}

const BUCKET = "deskos"

export class DeskOSCloud {
  private client: SupabaseClient | null = null
  private uid = ""
  private ready = false

  /** Row id per file name, so layout writes can target the right row. */
  private rowIdByName: Record<string, string> = {}
  private folderIdBySlug: Record<string, string> = {}

  /**
   * One-shot wipe before reading, so the next load re-seeds a clean desk.
   *
   * Development affordance, not a feature — test captures accumulate and eat
   * the chip reserves. Left off; flipped on deliberately.
   */
  purgeOnLoad = false

  /** True once signed in and a desk has been read. */
  isReady(): boolean {
    return this.ready
  }

  /**
   * Whether credentials have been imported at all.
   *
   * The asset ships blank until `supabase projects api-keys` has been run, so
   * this is the difference between "not configured yet" and "configured but
   * unreachable" — worth separating in the status line.
   */
  isConfigured(): boolean {
    return (
      supabaseProject !== null &&
      supabaseProject.url !== undefined &&
      supabaseProject.url !== null &&
      supabaseProject.url.length > 0 &&
      supabaseProject.publicToken.length > 0
    )
  }

  /**
   * Sign in, then read the desk. Resolves null when the backend is unavailable
   * for any reason — the caller treats that as "use sample content".
   */
  async load(): Promise<CloudDesk | null> {
    if (!this.isConfigured()) {
      print("[DeskOSCloud] No credentials imported — using sample content.")
      return null
    }

    // Preview is NOT categorically offline. Networking there is gated on the
    // Preview panel's Device Type Override being set to Specs — blocking on
    // isEditor() turned a configuration problem into an apparent platform limit
    // and swallowed the real error along with it.
    //
    // The hazard that guard protected against is real though: engaging the
    // Supabase client with no route stalls the JS context until a TimeoutError
    // takes the whole Lens down. So ask the cheap question first, and only
    // commit to the heavy client once something has actually answered.
    if (!(await this.probeNetwork())) return null

    try {
      this.client = createClient(supabaseProject.url, supabaseProject.publicToken, {
        realtime: {heartbeatIntervalMs: 2500} // required alpha workaround
      })
    } catch (e) {
      print("[DeskOSCloud] createClient failed: " + e)
      return null
    }

    if (!(await this.signIn())) return null
    if (this.purgeOnLoad) await this.purgeDesk()
    await this.bootstrapIfEmpty()
    return await this.readDesk()
  }

  /**
   * Snapchat OIDC first, anonymous as a fallback.
   *
   * `signInWithIdToken` always fails in Lens Studio preview, and can throw
   * AuthRetryableFetchError on device when the OIDC token is not ready at
   * startup — hence the retries before falling back.
   */
  private async signIn(): Promise<boolean> {
    const client = this.client
    if (client === null) return false

    for (let attempt = 0; attempt < 3; attempt++) {
      const {data, error} = await client.auth.signInWithIdToken({
        provider: "snapchat",
        token: "" // empty — Snapchat supplies it
      })
      if (!error && data !== null && data.user !== null) {
        this.uid = data.user.id
        print("[DeskOSCloud] Signed in: " + this.uid)
        return true
      }
      // Only a retryable fetch error is worth waiting on; anything else is final.
      const message = error === null ? "" : String(error.message)
      if (message.indexOf("Retryable") < 0) break
      await this.wait(1.0)
    }

    const anon = await client.auth.signInAnonymously()
    if (anon.error !== null || anon.data === null || anon.data.user === null) {
      print("[DeskOSCloud] Auth failed: " + JSON.stringify(anon.error))
      return false
    }
    this.uid = anon.data.user.id
    print("[DeskOSCloud] Signed in anonymously (preview): " + this.uid)
    return true
  }

  /**
   * Clear this user's desk — rows first, then the media behind them.
   *
   * RLS scopes every statement to the signed-in user, so this cannot reach
   * another desk even if the filter were wrong. Files go before folders,
   * because desk_files carries the folder foreign key. Seeded media lives
   * under `<kind>/seed/` and is shared, so only this user's own prefix is
   * touched.
   */
  private async purgeDesk(): Promise<void> {
    const client = this.client
    if (client === null) return

    const files = await client.from("desk_files").delete().eq("user_id", this.uid)
    if (files.error !== null) {
      print("[DeskOSCloud] Clearing files failed: " + JSON.stringify(files.error))
      return
    }
    const folders = await client.from("desk_folders").delete().eq("user_id", this.uid)
    if (folders.error !== null) {
      print("[DeskOSCloud] Clearing folders failed: " + JSON.stringify(folders.error))
      return
    }

    for (const kind of ["image", "audio"]) {
      const prefix = kind + "/" + this.uid
      const listing = await client.storage.from(BUCKET).list(prefix)
      if (listing.error !== null || listing.data === null) continue

      const paths: string[] = []
      for (const entry of listing.data) paths.push(prefix + "/" + entry.name)
      if (paths.length === 0) continue

      const removed = await client.storage.from(BUCKET).remove(paths)
      if (removed.error !== null) {
        print("[DeskOSCloud] Clearing " + kind + " media failed: " + JSON.stringify(removed.error))
        continue
      }
      print("[DeskOSCloud] Cleared " + paths.length + " " + kind + " upload(s).")
    }

    this.rowIdByName = {}
    this.folderIdBySlug = {}
    print("[DeskOSCloud] Desk cleared — bootstrap will re-seed.")
  }

  /**
   * Give a brand-new user their starting desk.
   *
   * Seeding via SQL is not an option: RLS scopes rows by `auth.uid()`, which is
   * null from the CLI, and every anonymous preview session is a different user.
   * So the MEDIA is shared — one public bucket, uploaded once — while the ROWS
   * are created client-side on first run, where `user_id` defaults to the
   * signed-in user. That keeps RLS intact and leaves the desk writable, which
   * is what layout persistence depends on.
   */
  private async bootstrapIfEmpty(): Promise<void> {
    const client = this.client
    if (client === null) return

    // Folders AND files, because seeding is two round trips and can be
    // interrupted between them. Checking only folders makes a half-seeded desk
    // look finished, and it then stays empty forever.
    const existingFolders = await client.from("desk_folders").select("id").limit(1)
    if (existingFolders.error !== null) {
      print("[DeskOSCloud] Bootstrap check failed: " + JSON.stringify(existingFolders.error))
      return
    }
    const existingFiles = await client.from("desk_files").select("id").limit(1)
    if (existingFiles.error !== null) {
      print("[DeskOSCloud] Bootstrap check failed: " + JSON.stringify(existingFiles.error))
      return
    }

    const haveFolders = existingFolders.data !== null && existingFolders.data.length > 0
    const haveFiles = existingFiles.data !== null && existingFiles.data.length > 0
    if (haveFolders && haveFiles) return

    // A desk with folders but no files is a partial seed. Clear the folders so
    // the insert below can recreate them and their ids line up with the files.
    if (haveFolders) {
      print("[DeskOSCloud] Partial desk found — reseeding.")
      const wipe = await client.from("desk_folders").delete().eq("user_id", this.uid)
      if (wipe.error !== null) {
        print("[DeskOSCloud] Reseed failed: " + JSON.stringify(wipe.error))
        return
      }
    } else {
      print("[DeskOSCloud] New user — seeding starting desk.")
    }

    const folderRows = [
      {slug: "projects", title: "Projects", subtitle: "Work in progress", sort_index: 0},
      {slug: "photos", title: "Photos", subtitle: "Captures & media", sort_index: 1},
      {slug: "personal", title: "Personal", subtitle: "Private files", sort_index: 2}
    ]
    const inserted = await client.from("desk_folders").insert(folderRows).select()
    if (inserted.error !== null || inserted.data === null) {
      print("[DeskOSCloud] Folder seed failed: " + JSON.stringify(inserted.error))
      return
    }

    const idBySlug: Record<string, string> = {}
    for (const row of inserted.data) idBySlug[row.slug] = row.id

    const fileRows = [
      {
        folder_id: idBySlug["projects"],
        kind: "text",
        name: "Roadmap",
        meta: "12 KB",
        body:
          "Q3 — spatial shell\nSurface anchoring is done. Folders\nreposition on the detected plane and\nhold their pose across sessions.\n\nNext: contents become first-class\nobjects, not just chips."
      },
      {
        folder_id: idBySlug["projects"],
        kind: "text",
        name: "Spec v2",
        meta: "48 KB",
        body:
          "Interaction model\nEvery object on the desk answers to\nthe same three states: hover, grabbed,\nreleased. Viewers stand up; files lie\nflat. Nothing is head-locked."
      },
      {
        folder_id: idBySlug["photos"],
        kind: "image",
        name: "Sunset",
        meta: "PNG",
        storage_path: "images/seed/sunset.png"
      },
      {
        folder_id: idBySlug["photos"],
        kind: "image",
        name: "Studio",
        meta: "PNG",
        storage_path: "images/seed/studio.png"
      },
      {
        folder_id: idBySlug["personal"],
        kind: "audio",
        name: "Voice memo",
        meta: "0:38",
        storage_path: "audio/seed/voice-memo.wav"
      },
      {
        folder_id: idBySlug["personal"],
        kind: "audio",
        name: "Idea 04",
        meta: "1:05",
        storage_path: "audio/seed/idea-04.wav"
      }
    ]
    const files = await client.from("desk_files").insert(fileRows)
    if (files.error !== null) {
      print("[DeskOSCloud] File seed failed: " + JSON.stringify(files.error))
      return
    }
    print("[DeskOSCloud] Seeded " + fileRows.length + " files.")
  }

  private async readDesk(): Promise<CloudDesk | null> {
    const client = this.client
    if (client === null) return false as unknown as null

    const folderRes = await client
      .from("desk_folders")
      .select("id, slug, title, subtitle, pos_x, pos_y")
      .order("sort_index", {ascending: true})
    if (folderRes.error !== null) {
      print("[DeskOSCloud] Folder read failed: " + JSON.stringify(folderRes.error))
      return null
    }

    const fileRes = await client
      .from("desk_files")
      .select(
        "id, folder_id, kind, name, meta, body, storage_path, pinned, grouped, offset_x, offset_y, rest_x, rest_y"
      )
    if (fileRes.error !== null) {
      print("[DeskOSCloud] File read failed: " + JSON.stringify(fileRes.error))
      return null
    }

    const folders: CloudFolder[] = []
    const slugById: Record<string, string> = {}
    for (const row of folderRes.data) {
      folders.push({
        id: row.id,
        slug: row.slug,
        title: row.title,
        subtitle: row.subtitle,
        posX: row.pos_x,
        posY: row.pos_y
      })
      slugById[row.id] = row.slug
      this.folderIdBySlug[row.slug] = row.id
    }

    const files: CloudFile[] = []
    for (const row of fileRes.data) {
      this.rowIdByName[row.name] = row.id
      files.push({
        id: row.id,
        folderSlug: row.folder_id === null ? "" : (slugById[row.folder_id] ?? ""),
        kind: row.kind as ContentKind,
        name: row.name,
        meta: row.meta,
        // Stored as one text column; the reader wants discrete lines.
        body: row.body === null ? null : String(row.body).split("\n"),
        storagePath: row.storage_path,
        pinned: row.pinned,
        grouped: row.grouped,
        offsetX: row.offset_x,
        offsetY: row.offset_y,
        restX: row.rest_x,
        restY: row.rest_y
      })
    }

    this.ready = true
    print("[DeskOSCloud] Loaded " + folders.length + " folders, " + files.length + " files.")
    return {folders, files}
  }

  /** Public URL for a stored object, for RemoteMediaModule to fetch. */
  publicUrl(storagePath: string): string | null {
    const client = this.client
    if (client === null) return null
    const {data} = client.storage.from(BUCKET).getPublicUrl(storagePath)
    return data === null ? null : data.publicUrl
  }

  /** Raw bytes for a stored object — used for textures via DynamicResource. */
  async download(storagePath: string): Promise<Uint8Array | null> {
    const client = this.client
    if (client === null) return null
    const {data, error} = await client.storage.from(BUCKET).download(storagePath)
    if (error !== null || data === null) {
      print("[DeskOSCloud] Download failed for " + storagePath)
      return null
    }
    return await data.bytes()
  }

  /**
   * Persist where a file ended up on the desk.
   *
   * Fire-and-forget by design: the arrangement is already correct locally, and
   * a failed write must never stall the interaction that caused it.
   */
  savePlacement(
    name: string,
    folderSlug: string,
    pinned: boolean,
    grouped: boolean,
    offsetX: number,
    offsetY: number,
    restX: number,
    restY: number
  ): void {
    const client = this.client
    const rowId = this.rowIdByName[name]
    if (client === null || !this.ready || rowId === undefined) return

    const folderId = this.folderIdBySlug[folderSlug]
    client
      .from("desk_files")
      .update({
        folder_id: folderId === undefined ? null : folderId,
        pinned,
        grouped,
        offset_x: offsetX,
        offset_y: offsetY,
        rest_x: restX,
        rest_y: restY,
        updated_at: new Date().toISOString()
      })
      .eq("id", rowId)
      .then((res) => {
        if (res.error !== null) {
          print("[DeskOSCloud] Placement save failed: " + JSON.stringify(res.error))
        }
      })
  }

  /** Persist a folder's position on the mat. */
  saveFolderPosition(slug: string, posX: number, posY: number): void {
    const client = this.client
    const folderId = this.folderIdBySlug[slug]
    if (client === null || !this.ready || folderId === undefined) return
    client
      .from("desk_folders")
      .update({pos_x: posX, pos_y: posY, updated_at: new Date().toISOString()})
      .eq("id", folderId)
      .then((res) => {
        if (res.error !== null) {
          print("[DeskOSCloud] Folder save failed: " + JSON.stringify(res.error))
        }
      })
  }

  /**
   * Upload captured bytes and register the row.
   *
   * Path is prefixed `<kind>/<uid>/` so the storage RLS delete policy — which
   * keys on the second path segment — scopes deletes to the uploader.
   */
  async uploadCapture(
    kind: ContentKind,
    name: string,
    meta: string,
    folderSlug: string,
    bytes: Uint8Array,
    contentType: string,
    extension: string
  ): Promise<CloudFile | null> {
    const client = this.client
    if (client === null || !this.ready) return null

    const path = kind + "/" + this.uid + "/" + Date.now() + "." + extension
    const up = await client.storage
      .from(BUCKET)
      .upload(path, bytes, {contentType, upsert: true})
    if (up.error !== null) {
      print("[DeskOSCloud] Upload failed: " + JSON.stringify(up.error))
      return null
    }

    const folderId = this.folderIdBySlug[folderSlug]
    const ins = await client
      .from("desk_files")
      .insert({
        folder_id: folderId === undefined ? null : folderId,
        kind,
        name,
        meta,
        storage_path: path,
        user_id: this.uid
      })
      .select()
    if (ins.error !== null || ins.data === null || ins.data.length === 0) {
      print("[DeskOSCloud] Row insert failed: " + JSON.stringify(ins.error))
      return null
    }

    const row = ins.data[0]
    this.rowIdByName[name] = row.id
    print("[DeskOSCloud] Uploaded " + path)
    return {
      id: row.id,
      folderSlug,
      kind,
      name,
      meta,
      body: null,
      storagePath: path,
      pinned: false,
      grouped: true,
      offsetX: 0,
      offsetY: 0,
      restX: 0,
      restY: 0
    }
  }

  dispose(): void {
    this.client?.removeAllChannels()
  }

  /**
   * Cheap reachability check, run before the Supabase client is ever touched.
   *
   * Two stages, cheapest first: ask the platform whether it has a route at all
   * (synchronous, free), then make one small real request to prove it. The
   * timeout is the point — a fetch over a blocked transport can hang rather
   * than reject, and an un-raced await on that is what took the Lens down.
   */
  private async probeNetwork(): Promise<boolean> {
    if (!global.deviceInfoSystem.isInternetAvailable()) {
      print(
        "[DeskOSCloud] No internet route. In Lens Studio preview this is " +
          "almost always the Preview panel's Device Type Override — set it to Specs."
      )
      return false
    }

    try {
      const response = await withTimeout(
        internetModule.fetch(supabaseProject.url + "/auth/v1/health", {method: "GET"}),
        PROBE_TIMEOUT_S
      )
      if (response === null) {
        print("[DeskOSCloud] Backend silent for " + PROBE_TIMEOUT_S + "s — treating as offline.")
        return false
      }
      print("[DeskOSCloud] Backend reachable (HTTP " + response.status + ").")
      return true
    } catch (e) {
      // The valuable case: the message names the actual refusal, e.g.
      // "HttpsOpenService for Wearable platform only".
      print("[DeskOSCloud] Backend unreachable: " + e)
      return false
    }
  }

  private wait(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const delayed = global.scene
        .createSceneObject("CloudWait")
        .createComponent("Component.ScriptComponent") as ScriptComponent
      const evt = delayed.createEvent("DelayedCallbackEvent")
      evt.bind(() => resolve())
      evt.reset(seconds)
    })
  }
}
