export function WorkspacePageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="workspace-page-header">
      <h1 id="workspace-title" tabIndex={-1}>
        {title}
      </h1>
      <p>{description}</p>
    </header>
  );
}
