"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { applyReferralCodeAction, type ReferralFormState } from "@/app/actions/billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ReferralCodeField({ initialCode }: { initialCode: string | null }) {
  const [state, formAction, pending] = useActionState(applyReferralCodeAction, undefined as ReferralFormState);
  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="referral-code" className="text-foreground/90">
          Referral code
        </Label>
        <Input
          id="referral-code"
          name="code"
          type="text"
          defaultValue={initialCode ?? ""}
          placeholder="Enter a member code"
          autoComplete="off"
          className="h-10 border-glow/30 bg-[#060e20]/90 uppercase hover:border-glow/50"
        />
        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending && <Loader2 className="animate-spin motion-reduce:animate-none" />}
        Apply code
      </Button>
    </form>
  );
}
