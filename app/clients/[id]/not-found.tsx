import Link from "next/link";

/**
 * Neutral denial for the client workspace (ticket 09).
 *
 * A client that does not exist and a client the caller may not access render
 * exactly this page: no name, status, id or any other metadata that would
 * reveal whether the client exists.
 */
export default function ClientWorkspaceNotFound() {
  return (
    <main className="shell">
      <h1>Клиент недоступен</h1>
      <p>Клиент не найден или у вас нет доступа к нему.</p>
      <p>
        <Link href="/clients">← К списку клиентов</Link>
      </p>
    </main>
  );
}
