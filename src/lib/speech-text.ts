/**
 * Texto limpio para síntesis de voz (sin HTML ni emojis).
 */
export function stripForSpeech(text: string): string {
  let s = text.replace(/<[^>]*>/g, " ");
  s = s.replace(/&[a-z]+;/gi, " ");
  s = s.replace(
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{200D}\u{E0020}-\u{E007F}]/gu,
    ""
  );
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
