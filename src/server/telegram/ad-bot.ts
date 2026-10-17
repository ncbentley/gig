const WELCOME = "Done following a thousand traders?\n\nFollow all of them.";
const START_CODE = /^[A-Za-z0-9_-]{1,64}$/;

/** The single /start argument, or null when the message is not one valid code. */
export function adBotCampaign(text: string): string | null {
  const match = text.trim().match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?$/);
  const code = match?.[1];
  if (!code || !START_CODE.test(code)) return null;
  return code;
}

export function adBotLink(appUrl: string, campaign: string | null): string {
  const url = new URL(`${appUrl.replace(/\/+$/, "")}/`);
  url.searchParams.set("utm_source", "telegram");
  url.searchParams.set("utm_medium", "cpc");
  if (campaign) url.searchParams.set("utm_campaign", campaign);
  return url.toString();
}

export function adBotReply(text: string, appUrl: string): string {
  return `${WELCOME}\n\n${adBotLink(appUrl, adBotCampaign(text))}`;
}
