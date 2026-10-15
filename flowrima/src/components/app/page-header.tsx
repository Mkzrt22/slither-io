export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement" className="space-y-4">
      <div className="h-9 w-48 animate-pulse-soft rounded-xl bg-surface-2" />
      <div className="h-40 animate-pulse-soft rounded-2xl bg-surface-2" />
      <div className="h-40 animate-pulse-soft rounded-2xl bg-surface-2" />
    </div>
  );
}
