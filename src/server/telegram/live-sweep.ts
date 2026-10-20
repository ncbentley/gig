/**
 * Newest dialogs, in the order Telegram returned them (most recent first).
 * A user chat is not a signal channel. A dialog with no top message cannot be compared.
 */
export interface DialogTipInput {
  isUser?: boolean;
  entityId?: string | number | bigint | { toString(): string } | null;
  messageId?: number | null;
}

export interface DialogTip {
  channelId: string;
  messageId: number;
}

function channelIdOf(value: DialogTipInput["entityId"]): string | null {
  if (value == null || value === "") return null;
  const s = typeof value === "object" ? value.toString() : String(value);
  if (!/^[1-9][0-9]*$/.test(s)) return null;
  return s;
}

export function liveDialogTips(dialogs: readonly DialogTipInput[]): DialogTip[] {
  const tips: DialogTip[] = [];
  for (const dialog of dialogs) {
    if (dialog.isUser) continue;
    const channelId = channelIdOf(dialog.entityId);
    const messageId = dialog.messageId;
    if (!channelId || messageId == null || !Number.isInteger(messageId) || messageId < 1) continue;
    tips.push({ channelId, messageId });
  }
  return tips;
}

/** Tracked channels whose newest post is ahead of the cursor. Untracked chats are ignored. */
export function tipsNewerThan(tips: readonly DialogTip[], lastMessageIdByChannel: ReadonlyMap<string, number>): DialogTip[] {
  return tips.filter((tip) => {
    const seen = lastMessageIdByChannel.get(tip.channelId);
    return seen != null && tip.messageId > seen;
  });
}
