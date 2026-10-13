"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { requestWithdrawalAction, type ReferralFormState } from "@/app/actions/referrals";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtMoney } from "@/lib/format";

export function ReferralWithdrawalForm({
  requestableCents,
  pendingAmountCents,
  disabled,
}: {
  requestableCents: number;
  pendingAmountCents: number | null;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(requestWithdrawalAction, undefined as ReferralFormState);
  return (
    <div className="space-y-3">
      {pendingAmountCents !== null && (
        <Alert className="border-amber-400/30 bg-amber-400/5">
          <AlertDescription>
            A withdrawal of {fmtMoney(pendingAmountCents)} is waiting for an admin to send.
          </AlertDescription>
        </Alert>
      )}
      <form action={formAction} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="withdrawal-amount" className="text-foreground/90">
            Amount (USD)
          </Label>
          <p className="text-xs text-muted-foreground">Minimum {fmtMoney(2500)}. Available {fmtMoney(requestableCents)}.</p>
          <Input
            id="withdrawal-amount"
            name="amount"
            type="number"
            min={25}
            step={0.01}
            required
            disabled={disabled}
            placeholder="25"
            className="h-10 max-w-xs border-glow/30 bg-[#060e20]/90 tabular-nums hover:border-glow/50"
          />
        </div>
        {state?.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={disabled || pending}>
          {pending && <Loader2 className="animate-spin motion-reduce:animate-none" />}
          Request withdrawal
        </Button>
      </form>
    </div>
  );
}
