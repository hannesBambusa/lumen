import { useMemo } from "react";

import type { Message, Person, PersonId } from "../types";
import { elapsed, initials } from "../lib/format";
import { avatarStyle } from "../lib/color";
import { useT } from "../lib/i18n";

interface Props {
  people: Person[];
  messages: Message[];
  selected: PersonId | null;
  onSelect: (id: PersonId) => void;
}

/**
 * The middle pane in People mode: who you talk to, most recent first.
 *
 * Machines sit in their own group at the bottom rather than mixed in. A newsletter is not
 * a correspondent, and letting them compete for the top of the list is what makes a normal
 * inbox feel crowded.
 */
export default function PeopleList({ people, messages, selected, onSelect }: Props) {
  const t = useT();
  const stats = useMemo(() => {
    const map = new Map<PersonId, { last: string; count: number; unread: boolean }>();
    for (const m of messages) {
      const current = map.get(m.personId);
      if (!current) {
        map.set(m.personId, { last: m.sentAt, count: 1, unread: Boolean(m.unread) });
        continue;
      }
      current.count += 1;
      current.unread = current.unread || Boolean(m.unread);
      if (new Date(m.sentAt) > new Date(current.last)) current.last = m.sentAt;
    }
    return map;
  }, [messages]);

  const rank = (a: Person, b: Person) =>
    new Date(stats.get(b.id)?.last ?? 0).getTime() - new Date(stats.get(a.id)?.last ?? 0).getTime();

  const humans = people.filter((p) => !p.isBroadcast).sort(rank);
  const machines = people.filter((p) => p.isBroadcast).sort(rank);

  const row = (person: Person) => {
    const stat = stats.get(person.id);
    return (
      <button
        key={person.id}
        className={`prow${person.id === selected ? " active" : ""}${stat?.unread ? " unread" : ""}`}
        onClick={() => onSelect(person.id)}
      >
        <span className="avatar" style={avatarStyle(person.email)} aria-hidden="true">
          {initials(person)}
        </span>
        <span className="prow-text">
          <span className="prow-name">{person.name}</span>
          <span className="prow-meta">
            {stat ? t.common.messages(stat.count) : t.list.noMessages}
            {stat && ` · ${t.common.ago(elapsed(stat.last))}`}
          </span>
        </span>
      </button>
    );
  };

  return (
    <section className="peoplelist" aria-label={t.list.people}>
      <h2 className="pane-label">{t.list.people}</h2>
      {humans.map(row)}
      <h2 className="pane-label">{t.list.machines}</h2>
      {machines.map(row)}
    </section>
  );
}
