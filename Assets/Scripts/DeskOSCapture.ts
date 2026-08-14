import {ContentKind} from "./DeskOSTypes"
import {DeskOSCloud} from "./DeskOSCloud"

/**
 * DeskOS — on-device capture.
 *
 * Turns the camera and microphone into new desk files. Plain TypeScript, driven
 * by DeskOS.ts; it knows nothing about the UI beyond handing back the file it
 * created.
 *
 * Neither path can run in Lens Studio preview: the camera is device-only and
 * Snap Cloud networking is wearable-only, so every method here reports its
 * refusal rather than failing silently.
 */

const cameraModule = require("LensStudio:CameraModule") as CameraModule

/** Voice is speech, not music — 16 kHz keeps the upload small with no audible loss. */
const VOICE_SAMPLE_RATE = 16000

export class DeskOSCapture {
  private recording = false
  private frames: Float32Array[] = []
  private sampleCount = 0
  private micControl: MicrophoneAudioProvider | null = null

  constructor(private cloud: DeskOSCloud) {}

  isRecording(): boolean {
    return this.recording
  }

  /**
   * Camera still → JPEG → Storage, registered as an image file in `folderSlug`.
   * Resolves with the new file's display name, or null if anything refused.
   */
  async capturePhoto(folderSlug: string): Promise<string | null> {
    if (global.deviceInfoSystem.isEditor()) {
      print("[DeskOSCapture] Camera is device-only — cannot capture in preview.")
      return null
    }
    if (!this.cloud.isReady()) {
      print("[DeskOSCapture] Cloud not ready — capture discarded.")
      return null
    }

    try {
      const request = CameraModule.createImageRequest()
      ;(request as unknown as {cameraId: number}).cameraId = CameraModule.CameraId.Default_Color
      const frame = await cameraModule.requestImage(request)

      const bytes = await this.encodeJpeg(frame.texture)
      if (bytes === null) return null

      const name = "Photo " + this.stamp()
      const file = await this.cloud.uploadCapture(
        "image" as ContentKind,
        name,
        "JPG",
        folderSlug,
        bytes,
        "image/jpeg",
        "jpg"
      )
      return file === null ? null : name
    } catch (e) {
      print("[DeskOSCapture] Photo capture failed: " + e)
      return null
    }
  }

  /**
   * Texture → JPEG bytes.
   *
   * Uses `encodeTextureAsync` + `decode`, which is what this runtime actually
   * exposes — there is no `Base64.encodeJpeg`, and `decode` already returns a
   * Uint8Array rather than a binary string.
   */
  private encodeJpeg(texture: Texture): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      Base64.encodeTextureAsync(
        texture,
        (encoded: string) => resolve(Base64.decode(encoded)),
        () => {
          print("[DeskOSCapture] JPEG encode failed.")
          resolve(null)
        },
        CompressionQuality.HighQuality,
        EncodingType.Jpg
      )
    })
  }

  // ── Voice notes ───────────────────────────────────────────────────────────

  /**
   * Begin recording.
   *
   * `micTrack` must be a Microphone audio track asset. There is no way to
   * synthesise one at runtime, so the caller supplies it and this reports
   * clearly when it is missing rather than half-working.
   */
  startRecording(micTrack: AudioTrackAsset | null): boolean {
    if (global.deviceInfoSystem.isEditor()) {
      print("[DeskOSCapture] Microphone is device-only — cannot record in preview.")
      return false
    }
    if (micTrack === null) {
      print("[DeskOSCapture] No microphone audio track wired — cannot record.")
      return false
    }
    if (this.recording) return false

    this.micControl = micTrack.control as MicrophoneAudioProvider
    this.micControl.sampleRate = VOICE_SAMPLE_RATE
    this.micControl.start()

    this.frames = []
    this.sampleCount = 0
    this.recording = true
    print("[DeskOSCapture] Recording…")
    return true
  }

  /** Call every frame while recording — the provider hands over what it buffered. */
  pump(): void {
    const mic = this.micControl
    if (!this.recording || mic === null) return

    const chunk = new Float32Array(mic.maxFrameSize)
    const shape = mic.getAudioFrame(chunk)
    if (shape.x <= 0) return
    this.frames.push(chunk.subarray(0, shape.x) as Float32Array)
    this.sampleCount += shape.x
  }

  /** Stop, encode to WAV, upload, and register the row. */
  async stopRecording(folderSlug: string): Promise<string | null> {
    const mic = this.micControl
    if (!this.recording || mic === null) return null

    this.recording = false
    mic.stop()

    if (this.sampleCount === 0) {
      print("[DeskOSCapture] Nothing recorded.")
      return null
    }

    // Read the rate back off the provider rather than trusting the request —
    // a mismatch here is what makes recordings play back pitch-shifted.
    const rate = mic.sampleRate
    const wav = this.encodeWav(this.frames, this.sampleCount, rate)
    this.frames = []

    const seconds = this.sampleCount / rate
    const name = "Memo " + this.stamp()
    const file = await this.cloud.uploadCapture(
      "audio" as ContentKind,
      name,
      this.duration(seconds),
      folderSlug,
      wav,
      "audio/wav",
      "wav"
    )
    return file === null ? null : name
  }

  /** 16-bit PCM mono with a RIFF header — the smallest thing every player accepts. */
  private encodeWav(frames: Float32Array[], total: number, rate: number): Uint8Array {
    const dataBytes = total * 2
    const out = new Uint8Array(44 + dataBytes)
    const view = new DataView(out.buffer)

    const ascii = (offset: number, text: string): void => {
      for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i)
    }

    ascii(0, "RIFF")
    view.setUint32(4, 36 + dataBytes, true)
    ascii(8, "WAVE")
    ascii(12, "fmt ")
    view.setUint32(16, 16, true) // PCM chunk size
    view.setUint16(20, 1, true) // format = PCM
    view.setUint16(22, 1, true) // mono
    view.setUint32(24, rate, true)
    view.setUint32(28, rate * 2, true) // byte rate
    view.setUint16(32, 2, true) // block align
    view.setUint16(34, 16, true) // bits per sample
    ascii(36, "data")
    view.setUint32(40, dataBytes, true)

    let offset = 44
    for (const frame of frames) {
      for (let i = 0; i < frame.length; i++) {
        const clamped = Math.max(-1, Math.min(1, frame[i]))
        view.setInt16(offset, clamped * 0x7fff, true)
        offset += 2
      }
    }
    return out
  }

  private duration(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const sec = Math.floor(seconds - m * 60)
    return m + ":" + (sec < 10 ? "0" : "") + sec
  }

  /** Local wall-clock label, so captures are tellable apart on the desk. */
  private stamp(): string {
    const d = new Date()
    const two = (n: number): string => (n < 10 ? "0" : "") + n
    return two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds())
  }
}
