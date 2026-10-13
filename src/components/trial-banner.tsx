import Link from "next/link";

export function TrialBanner({ endsAt }: { endsAt: Date }) {
  const daysLeft = Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 86_400_000));
  return (
    <div className="mb-6 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
      <p className="font-semibold">Your previous free trial is still active.</p>
      <p className="mt-1 text-muted-foreground">
        {daysLeft === 1 ? "One day" : `${daysLeft} days`} left on the legacy week of full access that started when you signed up. Basic keeps that book after it ends; Silver or Gold add more before {endsAt.toUTCString()}.
      </p>
      <Link href="/billing#plans" className="mt-2 inline-block font-semibold text-primary">
        See plans
      </Link>
    </div>
  );
}
