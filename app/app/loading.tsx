export default function Loading() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
        Preparing workspace...
      </div>
    </main>
  );
}
