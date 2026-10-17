import { describe, expect, it } from "vitest";
import { adBotCampaign, adBotLink, adBotReply } from "./ad-bot";

const APP = "https://goldintelligencegateway.com";

describe("ad bot reply", () => {
  it("keeps the welcome and adds the campaign from /start", () => {
    expect(adBotCampaign("/start spring_push")).toBe("spring_push");
    expect(adBotReply("/start spring_push", APP)).toBe(
      [
        "Done following a thousand traders?",
        "",
        "Follow all of them.",
        "",
        "https://goldintelligencegateway.com/?utm_source=telegram&utm_medium=cpc&utm_campaign=spring_push",
      ].join("\n"),
    );
  });

  it("accepts /start@bot and keeps the code's case", () => {
    expect(adBotCampaign("/start@GoldBot Spring_Push")).toBe("Spring_Push");
  });

  it("omits the campaign when there is no single valid code", () => {
    const plain = "https://goldintelligencegateway.com/?utm_source=telegram&utm_medium=cpc";
    expect(adBotLink(APP, null)).toBe(plain);
    expect(adBotCampaign("/start")).toBeNull();
    expect(adBotCampaign("hello")).toBeNull();
    expect(adBotCampaign("/start spring push")).toBeNull();
    expect(adBotCampaign("/start spring.push")).toBeNull();
    expect(adBotCampaign(`/start ${"a".repeat(65)}`)).toBeNull();
    expect(adBotReply("hello", `${APP}/`)).toContain(plain);
    expect(adBotReply("hello", `${APP}/`)).not.toContain("utm_campaign");
  });
});
