import { describe, expect, it } from "vitest";
import { liveDialogTips, tipsNewerThan } from "./live-sweep";

describe("live dialog sweep", () => {
  it("keeps channel tips in newest-first order and drops users and empty dialogs", () => {
    const tips = liveDialogTips([
      { isUser: true, entityId: "1", messageId: 9 },
      { entityId: { toString: () => "100" }, messageId: 40 },
      { entityId: "200", messageId: null },
      { entityId: "300", messageId: 12 },
    ]);
    expect(tips).toEqual([
      { channelId: "100", messageId: 40 },
      { channelId: "300", messageId: 12 },
    ]);
  });

  it("returns only tracked channels whose top message is ahead of the cursor", () => {
    const tracked = new Map([
      ["100", 40],
      ["300", 10],
    ]);
    expect(
      tipsNewerThan(
        [
          { channelId: "100", messageId: 40 },
          { channelId: "300", messageId: 12 },
          { channelId: "999", messageId: 3 },
        ],
        tracked,
      ),
    ).toEqual([{ channelId: "300", messageId: 12 }]);
  });
});
