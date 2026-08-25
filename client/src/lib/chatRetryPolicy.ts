export type ConversationItem = {
  role: "user" | "assistant";
  content: string;
};

export function buildTextRequestContext(
  history: ConversationItem[],
  text: string,
  isRetry: boolean,
) {
  if (isRetry) return history;
  return [...history, { role: "user" as const, content: text }].slice(-8);
}
