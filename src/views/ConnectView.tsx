import { useT } from "../lib/i18n";

interface Props {
  onConnect: () => void;
  busy: boolean;
  status: string | null;
  error: string | null;
}

/**
 * First launch. One thing to do, said plainly.
 *
 * The claims here have to stay true: no server, nothing leaves the machine, no password
 * typed into Lumen. They are the reason someone would hand a mail client their inbox, and
 * an app that says them and then does otherwise deserves to be uninstalled.
 */
export default function ConnectView({ onConnect, busy, status, error }: Props) {
  const t = useT();
  return (
    <div className="connect">
      <div className="connect-card">
        <div className="connect-mark" aria-hidden="true">
          Lumen
        </div>

        <h1 className="connect-title">{t.connect.title}</h1>
        <p className="connect-lede">{t.connect.lede}</p>

        <button className="connect-btn" onClick={onConnect} disabled={busy}>
          {busy ? t.connect.waiting : t.connect.button}
        </button>

        {status && <p className="connect-status">{status}</p>}
        {error && <p className="connect-error">{error}</p>}

        <ul className="connect-facts">
          <li>{t.connect.fact1}</li>
          <li>{t.connect.fact2}</li>
          <li>{t.connect.fact3}</li>
        </ul>

        <p className="connect-fine">{t.connect.fine}</p>
      </div>
    </div>
  );
}
