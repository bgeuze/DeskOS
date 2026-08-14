/**
 * DeskOS — sound effect playback.
 *
 * Plain TypeScript (no @component). Centralises every requireAsset for audio so
 * the cue set is findable in one place, and owns the Specs playback-mode choice.
 */

const SFX_SURFACE_LOCK = requireAsset("../GeneratedSFX/SurfaceLock.wav") as AudioTrackAsset
const SFX_DESK_PLACE = requireAsset("../GeneratedSFX/DeskPlace.wav") as AudioTrackAsset
const SFX_CARD_HOVER = requireAsset("../GeneratedSFX/CardHover.wav") as AudioTrackAsset
const SFX_CARD_SELECT = requireAsset("../GeneratedSFX/CardSelect.wav") as AudioTrackAsset

export class DeskOSAudio {
  private surfaceLock: AudioComponent
  private deskPlace: AudioComponent
  private cardHover: AudioComponent
  private cardSelect: AudioComponent

  constructor(host: SceneObject) {
    this.surfaceLock = this.makeCue(host, SFX_SURFACE_LOCK, 0.5)
    this.deskPlace = this.makeCue(host, SFX_DESK_PLACE, 0.85)
    this.cardHover = this.makeCue(host, SFX_CARD_HOVER, 0.35)
    this.cardSelect = this.makeCue(host, SFX_CARD_SELECT, 0.7)
  }

  /**
   * Every cue here is input-reactive (hover, select, place), so all four get
   * LowLatency. Specs defaults AudioComponent to LowPower, which adds audible
   * lag after a pinch; the extra power draw is the right trade for feedback.
   */
  private makeCue(host: SceneObject, track: AudioTrackAsset, volume: number): AudioComponent {
    const audio = host.createComponent("Component.AudioComponent") as AudioComponent
    audio.audioTrack = track
    audio.volume = volume
    audio.playbackMode = Audio.PlaybackMode.LowLatency
    return audio
  }

  private fire(audio: AudioComponent): void {
    if (audio.isPlaying()) audio.stop(false)
    audio.play(1)
  }

  /** A valid horizontal surface just came under the pointer. */
  playSurfaceLock(): void {
    this.fire(this.surfaceLock)
  }

  /** The desk was committed to a surface. */
  playDeskPlace(): void {
    this.fire(this.deskPlace)
  }

  /** Pointer entered a folder card. */
  playCardHover(): void {
    this.fire(this.cardHover)
  }

  /** A folder card was selected. */
  playCardSelect(): void {
    this.fire(this.cardSelect)
  }
}
