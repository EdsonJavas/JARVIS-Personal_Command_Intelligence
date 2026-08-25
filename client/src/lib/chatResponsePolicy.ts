export function shouldSpeakChatReply({
  enabled,
  canSpeak,
  hasVoice,
}: {
  enabled: boolean;
  canSpeak: boolean;
  hasVoice: boolean;
}) {
  return enabled && canSpeak && hasVoice;
}
