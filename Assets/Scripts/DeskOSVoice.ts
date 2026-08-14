/**
 * DeskOS — speech input.
 *
 * Push-to-talk transcription. Plain TypeScript, no @component; DeskOS.ts holds
 * it and decides what the words mean.
 *
 * Deliberately push-to-talk rather than a wake word. The ASR guidance is blunt
 * about keyword spotting — partial transcripts churn, finals arrive late, and
 * short command words are misheard — so nothing here listens for a trigger
 * phrase. The user holds a button, speaks freely, and the finished sentence is
 * handed to a model that can cope with "put that with my project stuff" as
 * readily as with an exact command.
 */

const asrModule = require("LensStudio:AsrModule") as AsrModule

/**
 * How long a pause ends the phrase.
 *
 * Commands are short and the user is holding a button, so waiting a full
 * second after they stop talking just feels slow.
 */
const SILENCE_MS = 700

export class DeskOSVoice {
  private listening = false
  private bound = false
  private onFinal: ((text: string) => void) | null = null
  private options: AsrModule.AsrTranscriptionOptions | null = null
  /**
   * The teardown of the previous session, while it is still running.
   *
   * A finished phrase does not close the session — that has to be asked for.
   * Starting a new one on top of a live session yields AsrStatusCode 1
   * (InternalError), which is why the first command worked and every one after
   * it failed.
   */
  private closing: Promise<void> | null = null

  isListening(): boolean {
    return this.listening
  }

  /**
   * Begin a listening session. `onFinal` fires once, with the completed phrase.
   *
   * Returns false only when a session is already running — an unavailable
   * microphone surfaces through onTranscriptionErrorEvent instead, because the
   * platform's own status code says more than a guess made up front.
   */
  async start(
    onFinal: (text: string) => void,
    onError: (code: string) => void
  ): Promise<boolean> {
    if (this.listening) return false

    // Let the previous session finish closing before opening another.
    if (this.closing !== null) {
      try {
        await this.closing
      } catch (e) {
        print("[DeskOSVoice] Previous session did not close cleanly: " + e)
      }
      this.closing = null
    }

    this.onFinal = onFinal

    if (this.options === null) {
      this.options = AsrModule.AsrTranscriptionOptions.create()
      this.options.mode = AsrModule.AsrMode.HighAccuracy
      this.options.silenceUntilTerminationMs = SILENCE_MS
    }

    // Bound once. The options object is reused across sessions, so binding per
    // start would stack duplicate handlers and fire the callback N times.
    if (!this.bound) {
      this.bound = true
      this.options.onTranscriptionUpdateEvent.add((event: AsrModule.TranscriptionUpdateEvent) => {
        if (!event.isFinal) return
        const text = event.text.trim()
        this.listening = false
        // Close it now: the phrase being final does not end the session, and a
        // session left open poisons the next one.
        this.closing = asrModule.stopTranscribing()
        print("[DeskOSVoice] Heard: " + text)
        const handler = this.onFinal
        this.onFinal = null
        if (handler !== null && text.length > 0) handler(text)
      })
      this.options.onTranscriptionErrorEvent.add((code: AsrModule.AsrStatusCode) => {
        this.listening = false
        this.onFinal = null
        // Tear down on failure too, or the bad session blocks every retry.
        this.closing = asrModule.stopTranscribing()
        print("[DeskOSVoice] Transcription error: " + code)
        onError(String(code))
      })
    }

    this.listening = true
    asrModule.startTranscribing(this.options)
    print("[DeskOSVoice] Listening…")
    return true
  }

  /** End the session early — the final phrase still arrives if one was formed. */
  stop(): void {
    if (!this.listening) return
    this.listening = false
    this.closing = asrModule.stopTranscribing()
  }
}
