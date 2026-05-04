export function MarkdownBody({
  body,
  bodyHtml,
}: {
  body: string;
  bodyHtml?: string;
}) {
  if (bodyHtml) {
    return (
      <div
        className="markdown-body text-sm text-slate-700"
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />
    );
  }

  return <p className="text-sm text-slate-700 whitespace-pre-wrap">{body}</p>;
}
