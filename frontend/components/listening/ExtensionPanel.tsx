// Keeps the place of the Phase 2 panels from workbook Figure 6.7.
export function ExtensionPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section
      aria-label={`${title}, planned for Phase 2`}
      className="rounded-lg border-2 border-dashed border-line p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
          extension · Phase 2
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">{description}</p>
    </section>
  );
}
