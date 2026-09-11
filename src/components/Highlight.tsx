import { segments } from "../lib/search";

interface Props {
  text: string;
  query: string;
}

/**
 * Text with the searched-for parts marked.
 *
 * The point of a search result is not that it matched but *why*. In a mailbox of thousands,
 * a list of plausible-looking rows with nothing to distinguish them is only marginally
 * better than the inbox you were trying to escape.
 */
export default function Highlight({ text, query }: Props) {
  if (!query.trim()) return <>{text}</>;

  return (
    <>
      {segments(text, query).map((part, index) =>
        part.hit ? (
          <mark key={index} className="hit">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}
