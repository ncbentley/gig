import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signupAction } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/server/auth";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  if (await getCurrentUser()) redirect("/dashboard");
  const next = typeof sp.next === "string" ? sp.next : "";
  return (
    <AuthCard
      title="Create your account"
      description="Then choose a monthly plan or the 10-day pass. A new account does not include signal access."
      footer={
        <>
          Already a member? <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-primary hover:underline">Sign in</Link>
        </>
      }
    >
      <AuthForm
        action={signupAction}
        submitLabel="Create account"
        terms
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email", placeholder: "you@example.com" },
          { name: "password", label: "Password", type: "password", autoComplete: "new-password", placeholder: "At least 8 characters" },
        ]}
      />
    </AuthCard>
  );
}
