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

/** One frozen frame, encoded once and usable by both consumers. */
export interface CapturedFrame {
  /** For Gemini, which takes image bytes inline as base64. */
  base64: string
  /** For Storage, which takes raw bytes. */
  bytes: Uint8Array
  /** For showing the user what they just captured, before it is understood. */
  texture: Texture
}

export class DeskOSCapture {
  private cameraTexture: Texture | null = null
  private frameReg: EventRegistration | null = null
  private framesSeen = 0
  private recording = false
  private frames: Float32Array[] = []
  private sampleCount = 0
  private micControl: MicrophoneAudioProvider | null = null

  constructor(private cloud: DeskOSCloud) {}

  isRecording(): boolean {
    return this.recording
  }

  /**
   * Begin the continuous camera stream.
   *
   * Deliberately not `requestImage`. Still capture is device-only, so building
   * on it would make the whole feature undemonstrable without hardware — and
   * unverifiable, which is worse. The continuous stream runs in the editor too,
   * so copying a frame off the live texture is both the portable path and the
   * responsive one: the frame is already in hand when the user pinches, rather
   * than being requested at that moment.
   */
  startCamera(): void {
    if (this.cameraTexture !== null) return

    try {
      const request = CameraModule.createCameraRequest()
      request.cameraId = CameraModule.CameraId.Default_Color
      this.cameraTexture = cameraModule.requestCamera(request)
      const provider = this.cameraTexture.control as CameraTextureProvider
      // Counting frames rather than trusting the request: a stream that was
      // accepted but never delivers is indistinguishable from a working one
      // until you ask for a frame and get nothing.
      this.frameReg = provider.onNewFrame.add(() => {
        this.framesSeen++
      })
      print("[DeskOSCapture] Camera stream started.")
    } catch (e) {
      print("[DeskOSCapture] Camera unavailable: " + e)
      this.cameraTexture = null
    }
  }

  stopCamera(): void {
    const texture = this.cameraTexture
    if (texture !== null && this.frameReg !== null) {
      const provider = texture.control as CameraTextureProvider
      provider.onNewFrame.remove(this.frameReg)
    }
    this.frameReg = null
    this.cameraTexture = null
    this.framesSeen = 0
  }

  /** True only once the stream has actually delivered something worth copying. */
  isCameraReady(): boolean {
    return this.cameraTexture !== null && this.framesSeen > 0
  }

  /**
   * Freeze the current frame and encode it once.
   *
   * Both representations come out of a single encode because both are needed —
   * base64 goes to Gemini inline, the decoded bytes go to Storage. Encoding
   * twice would double the cost of every capture for nothing.
   */
  async grabFrame(): Promise<CapturedFrame | null> {
    if (!this.isCameraReady()) {
      print("[DeskOSCapture] No camera frame available yet.")
      return null
    }

    const frozen = (this.cameraTexture as Texture).copyFrame()
    const base64 = await this.encodeJpeg(frozen)
    if (base64 === null) return null

    return {base64, bytes: Base64.decode(base64), texture: frozen}
  }

  /**
   * Texture → base64 JPEG.
   *
   * `encodeTextureAsync` is what this runtime actually exposes — there is no
   * `Base64.encodeJpeg`, whatever the samples suggest.
   */
  private encodeJpeg(texture: Texture): Promise<string | null> {
    return new Promise((resolve) => {
      Base64.encodeTextureAsync(
        texture,
        (encoded: string) => resolve(encoded),
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
