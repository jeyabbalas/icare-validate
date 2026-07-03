import type { FileSlot } from '../state/inputStore';

// Shared slot → content helpers. A FileSlot references its data either as an in-memory File (an upload
// or a fetched example) or as a base-relative {url}; these two helpers resolve that split uniformly so
// any consumer that needs the raw bytes (re-parsing for preview/merge) or a stable identity key handles
// both alike. Type-only import of FileSlot keeps this a leaf module with no runtime dependency cycle.

/** A stable identity string for a slot's current source — changes iff the referenced file/URL changes. */
export function fileKey(slot: FileSlot): string {
  return slot.file
    ? `${slot.file.name}:${slot.file.size}:${slot.file.lastModified}`
    : (slot.url ?? '');
}

/** Resolve a slot to a File, fetching the URL-backed case. Throws if the slot references nothing. */
export async function slotToFile(slot: FileSlot): Promise<File> {
  if (slot.file) return slot.file;
  if (slot.url) {
    const blob = await (await fetch(slot.url)).blob();
    return new File([blob], slot.filename ?? 'file');
  }
  throw new Error('empty slot');
}
