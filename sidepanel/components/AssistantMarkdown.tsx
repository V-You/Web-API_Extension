import Markdown from "react-markdown";

const ALLOWED_ELEMENTS = [
  "p",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "code",
  "pre",
  "a",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
] as const;

export function AssistantMarkdown({ text }: { text: string }) {
  return (
    <Markdown
      allowedElements={[...ALLOWED_ELEMENTS]}
      unwrapDisallowed
      components={{
        a({ children, href, ...props }) {
          return (
            <a
              {...props}
              href={href}
              rel="noreferrer noopener"
              target="_blank"
              className="text-blue-700 underline underline-offset-2"
            >
              {children}
            </a>
          );
        },
        blockquote({ children, ...props }) {
          return (
            <blockquote {...props} className="border-l-2 border-slate-300 pl-3 italic text-slate-600">
              {children}
            </blockquote>
          );
        },
        code({ children, className, ...props }) {
          return (
            <code {...props} className={`rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.95em] ${className ?? ""}`.trim()}>
              {children}
            </code>
          );
        },
        h1({ children, ...props }) {
          return <h1 {...props} className="mt-2 text-base font-semibold first:mt-0">{children}</h1>;
        },
        h2({ children, ...props }) {
          return <h2 {...props} className="mt-2 text-sm font-semibold first:mt-0">{children}</h2>;
        },
        h3({ children, ...props }) {
          return <h3 {...props} className="mt-2 text-sm font-medium first:mt-0">{children}</h3>;
        },
        h4({ children, ...props }) {
          return <h4 {...props} className="mt-2 text-sm font-medium first:mt-0">{children}</h4>;
        },
        li({ children, ...props }) {
          return <li {...props} className="ml-5 list-disc leading-snug">{children}</li>;
        },
        ol({ children, ...props }) {
          return <ol {...props} className="my-1 list-decimal">{children}</ol>;
        },
        p({ children, ...props }) {
          return <p {...props} className="my-1 first:mt-0 last:mb-0 leading-snug">{children}</p>;
        },
        pre({ children, ...props }) {
          return (
            <pre {...props} className="my-1 overflow-x-auto rounded-md bg-slate-100 p-2 text-xs">
              {children}
            </pre>
          );
        },
        ul({ children, ...props }) {
          return <ul {...props} className="my-1">{children}</ul>;
        },
      }}
    >
      {text}
    </Markdown>
  );
}