"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { revokeTelegramLink } from "@/server/telegram/links";

export async function disconnectTelegramAction() {
  const user = await requireUser();
  await revokeTelegramLink(user.id);
  redirect("/account?telegram=disconnected");
}
