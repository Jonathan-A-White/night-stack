/**
 * Placeholder page for routes the app shell registers before the owning
 * workstream lands (specs/home-experiments/app-shell.md). Keeps every tab
 * navigable end-to-end.
 */
export function ComingSoon({ title, spec }: { title: string; spec: string }) {
  return (
    <div>
      <div className="page-header">
        <h1>{title}</h1>
      </div>
      <div className="empty-state">
        <h3>Coming soon</h3>
        <p className="text-secondary">
          This screen is specified in <code>specs/home-experiments/{spec}</code> and has not landed yet.
        </p>
      </div>
    </div>
  );
}
