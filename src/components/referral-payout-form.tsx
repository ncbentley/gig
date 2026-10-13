"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { savePayoutAccountAction, type ReferralFormState } from "@/app/actions/referrals";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ReferralPayoutForm({ accountHolderName }: { accountHolderName: string | null }) {
  const [state, formAction, pending] = useActionState(savePayoutAccountAction, undefined as ReferralFormState);
  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="payout-holder" className="text-foreground/90">
          Account holder name
        </Label>
        <Input
          id="payout-holder"
          name="accountHolderName"
          required
          defaultValue={accountHolderName ?? ""}
          autoComplete="name"
          className="h-10 border-glow/30 bg-[#060e20]/90 hover:border-glow/50"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="payout-routing" className="text-foreground/90">
          Routing number
        </Label>
        <Input
          id="payout-routing"
          name="routingNumber"
          required
          inputMode="numeric"
          autoComplete="off"
          className="h-10 border-glow/30 bg-[#060e20]/90 font-mono hover:border-glow/50"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="payout-account" className="text-foreground/90">
          Account number
        </Label>
        <Input
          id="payout-account"
          name="accountNumber"
          required
          inputMode="numeric"
          autoComplete="off"
          className="h-10 border-glow/30 bg-[#060e20]/90 font-mono hover:border-glow/50"
        />
      </div>
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending && <Loader2 className="animate-spin motion-reduce:animate-none" />}
        Save bank details
      </Button>
    </form>
  );
}
