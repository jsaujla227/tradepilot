import { LoginForm } from "./_components/login-form";

export const metadata = {
  title: "Sign in · TradePilot",
  description: "Magic-link sign in for the private cockpit.",
};

export default function LoginPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <div aria-hidden className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
            <span>Private</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Sign in to TradePilot
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Single-user cockpit. We&apos;ll email you a magic link.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
