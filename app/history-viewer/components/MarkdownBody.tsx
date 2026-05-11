import { Fragment } from "react";

function isTableSeparator(line: string) {
  const trimmed = line.trim();
  return /^(\|\s*:?-+:?\s*)+\|?$/.test(trimmed);
}

function parseTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderMarkdown(body: string) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h3
          key={`h3-${index}`}
          className="mt-4 text-lg font-semibold text-slate-900"
        >
          {trimmed.slice(4)}
        </h3>,
      );
      index += 1;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      blocks.push(
        <h2
          key={`h2-${index}`}
          className="mt-5 text-xl font-semibold text-slate-950"
        >
          {trimmed.slice(3)}
        </h2>,
      );
      index += 1;
      continue;
    }

    if (trimmed.startsWith("# ")) {
      blocks.push(
        <h1
          key={`h1-${index}`}
          className="mt-5 text-2xl font-semibold text-slate-950"
        >
          {trimmed.slice(2)}
        </h1>,
      );
      index += 1;
      continue;
    }

    if (trimmed.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("- ")) {
        items.push(lines[index].trim().slice(2));
        index += 1;
      }

      blocks.push(
        <ul
          key={`ul-${index}`}
          className="ml-5 list-disc space-y-1 text-sm text-slate-700"
        >
          {items.map((item, itemIndex) => (
            <li key={`li-${itemIndex}`}>{item}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (
      trimmed.includes("|") &&
      index + 1 < lines.length &&
      isTableSeparator(lines[index + 1] || "")
    ) {
      const header = parseTableRow(lines[index]);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && lines[index].trim().includes("|")) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
      }

      blocks.push(
        <div
          key={`table-${index}`}
          className="overflow-x-auto rounded-xl border border-slate-200"
        >
          <table className="min-w-full border-collapse text-sm text-slate-700">
            <thead className="bg-slate-100 text-slate-900">
              <tr>
                {header.map((cell, cellIndex) => (
                  <th
                    key={`th-${cellIndex}`}
                    className="border-b border-slate-200 px-3 py-2 text-left font-semibold"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`tr-${rowIndex}`} className="bg-white align-top">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`td-${rowIndex}-${cellIndex}`}
                      className="border-t border-slate-200 px-3 py-2 whitespace-pre-wrap"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (
        !current ||
        current.startsWith("#") ||
        current.startsWith("- ") ||
        (current.includes("|") &&
          index + 1 < lines.length &&
          isTableSeparator(lines[index + 1] || ""))
      ) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }

    blocks.push(
      <p
        key={`p-${index}`}
        className="whitespace-pre-wrap text-sm leading-7 text-slate-700"
      >
        {paragraphLines.join(" ")}
      </p>,
    );
  }

  return <div className="space-y-3">{blocks}</div>;
}

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

  return <Fragment>{renderMarkdown(body)}</Fragment>;
}
