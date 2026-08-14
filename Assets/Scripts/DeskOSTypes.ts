/**
 * Shared DeskOS vocabulary.
 *
 * Lives apart from DeskOSUI so the cloud layer and the UI can both name a file
 * kind without importing each other — DeskOSUI imports DeskOSCloud, so the type
 * cannot live in DeskOSUI.
 */
export type ContentKind = "text" | "image" | "video" | "audio"
