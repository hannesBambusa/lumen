import { useState } from "react";

import type { Message } from "../types";
import { useT } from "../lib/i18n";

/** Beyond this the list is folded, because a wide cc line pushes the message off screen. */
const SHOWN = 3;

interface Props {
  message: Message;
}

/**
 * Who a message came from and who else got it, addresses included.
 *
 * Names alone cannot be checked: two people called Kristin, a stranger whose display name
 * matches a colleague's, or a reply that quietly goes to a different address are all
 * invisible until you can see what is actually written in the header. So the address is
 * always there, and the whole line is selectable so it can be copied.
 *
 * Folded past a few recipients rather than truncated: a forty-person cc is exactly the case
 * where you want to be able to look, and exactly the case that would otherwise bury the
 * message itself.
 */
export default function Addressing({ message }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const to = message.audience?.to ?? [];
  const copies = message.audience?.copies ?? [];
  if (!message.sender && to.length === 0 && copies.length === 0) return null;

  const folded = !open && to.length + copies.length > SHOWN;

  return (
    <div className="addresses">
      {message.sender && (
        <div className="addr-line">
          <span className="addr-label">{t.message.from}</span>
          <span className="addr-people">
            <Person name={message.sender.name} email={message.sender.email} />
          </span>
        </div>
      )}

      {to.length > 0 && (
        <div className="addr-line">
          <span className="addr-label">{t.message.to}</span>
          <span className="addr-people">
            <People list={folded ? to.slice(0, SHOWN) : to} />
            {folded && to.length > SHOWN && (
              <button className="addr-more" onClick={() => setOpen(true)}>
                {t.message.andMore(to.length - SHOWN)}
              </button>
            )}
          </span>
        </div>
      )}

      {copies.length > 0 && (folded ? to.length < SHOWN : true) && (
        <div className="addr-line">
          <span className="addr-label">{t.message.cc}</span>
          <span className="addr-people">
            <People list={folded ? copies.slice(0, SHOWN - to.length) : copies} />
            {folded && (
              <button className="addr-more" onClick={() => setOpen(true)}>
                {t.message.andMore(copies.length - Math.max(0, SHOWN - to.length))}
              </button>
            )}
          </span>
        </div>
      )}

      {/* The count is the thing worth knowing when the list is folded away entirely. */}
      {folded && to.length >= SHOWN && copies.length > 0 && (
        <button className="addr-more block" onClick={() => setOpen(true)}>
          {t.message.copiedTo(copies.length)}
        </button>
      )}
    </div>
  );
}

function People({ list }: { list: Array<{ name: string; email: string }> }) {
  return (
    <>
      {list.map((person, index) => (
        <span key={`${person.email}-${index}`}>
          {index > 0 && ", "}
          <Person name={person.name} email={person.email} />
        </span>
      ))}
    </>
  );
}

function Person({ name, email }: { name: string; email: string }) {
  // The name is dropped when it is only the address again, so nothing is said twice.
  const sameAsEmail = name.toLowerCase() === email.toLowerCase();
  return (
    <span className="addr-person" title={email}>
      {!sameAsEmail && <span className="addr-name">{name}</span>}
      <span className="addr-mail">{sameAsEmail ? email : `<${email}>`}</span>
    </span>
  );
}
