export function Placeholder({
  title,
  description,
  milestone,
}: {
  title: string;
  description: string;
  milestone: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:py-14">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      </header>
      <div className="rounded-xl border border-dashed border-border bg-card/30 p-8 text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Coming in {milestone}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Not yet wired up. Check back after this milestone ships.
        </p>
      </div>
    </div>
  );
}
