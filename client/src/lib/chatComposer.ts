export function shouldSubmitComposer({
  key,
  shiftKey,
  hasMessage,
  isPending,
}: {
  key: string;
  shiftKey: boolean;
  hasMessage: boolean;
  isPending: boolean;
}) {
  return key === "Enter" && !shiftKey && hasMessage && !isPending;
}
