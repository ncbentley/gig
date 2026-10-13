import Link from "next/link";

export function TrialBanner({ endsAt }: { endsAt: Date }) {
  const daysLeft = Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 86_400_000));
  return (
    <div className="mb-6 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
      <p className="font-semibold">Your previous free trial is still active.</p>
      <p className="mt-1 text-muted-foreground">
        {daysLeft === 1 ? "One day" : `${daysLeft} days`} left. This is the free week from when you signed up, not the $10 pass.
      </p>
      <Link href="/billing#plans" className="mt-2 inline-block font-semibold text-primary">
        See plans
      </Link>
    </div>
  );
}
