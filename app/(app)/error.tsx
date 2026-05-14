"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="max-w-sm space-y-4 text-center">
        <p className="text-sm font-medium text-foreground">Something went wrong</p>
        <p className="text-xs text-muted-foreground">
          {error.message ?? "An unexpected error occurred."}
          {error.digest && (
            <span className="ml-1 font-mono opacity-60">({error.digest})</span>
          )}
        </p>
        <button
          onClick={reset}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:bg-foreground/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
