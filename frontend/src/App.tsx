import { useState, useEffect, type CSSProperties } from "react";

interface EventItem {
  id: string;
  eventType: string;
  payload: string;
  createdAt: string;
}

interface Subscription {
  id: string;
  name: string;
  url: string;
  eventType: string;
  isActive: boolean;
  createdAt: string;
}

const API_BASE = "http://localhost:5180";

function App() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [eventType, setEventType] = useState("");
  const [error, setError] = useState("");

  const loadSubscriptions = () => {
    fetch(`${API_BASE}/subscriptions`)
      .then((res) => res.json())
      .then(setSubscriptions)
      .catch(() => setSubscriptions([]));
  };

  const loadEvents = () => {
    fetch(`${API_BASE}/events`)
      .then((res) => res.json())
      .then(setEvents)
      .catch(() => setEvents([]));
  };

  useEffect(() => {
    loadEvents();
    loadSubscriptions();
  }, []);

  const handleAddSubscription = async () => {
    setError("");
    const res = await fetch(`${API_BASE}/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, url, eventType }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}) as { error?: string });
      setError(data.error ?? "Could not create subscription.");
      return;
    }

    setName("");
    setUrl("");
    setEventType("");
    loadSubscriptions();
  };

  const handleDelete = async (id: string) => {
    await fetch(`${API_BASE}/subscriptions/${id}`, { method: "DELETE" });
    loadSubscriptions();
  };

  return (
    <div style={page}>
      <h1>Webhook Delivery System</h1>

      <section style={{ marginTop: "2rem" }}>
        <h2>Add a subscription</h2>
        <div style={formRow}>
          <input
            style={input}
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            style={input}
            placeholder="https://example.com/hook"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            style={input}
            placeholder="event type (e.g. order.created)"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          />
          <button style={button} onClick={handleAddSubscription}>
            Add
          </button>
        </div>
        {error && (
          <p style={{ color: "crimson", marginTop: "0.5rem" }}>{error}</p>
        )}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Subscriptions ({subscriptions.length})</h2>
        {subscriptions.length === 0 ? (
          <p>No subscriptions yet.</p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>URL</th>
                <th style={th}>Event Type</th>
                <th style={th}>Active</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((s) => (
                <tr key={s.id}>
                  <td style={td}>{s.name}</td>
                  <td style={td}>{s.url}</td>
                  <td style={td}>{s.eventType}</td>
                  <td style={td}>{s.isActive ? "Yes" : "No"}</td>
                  <td style={td}>
                    <button
                      style={deleteButton}
                      onClick={() => handleDelete(s.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Events ({events.length})</h2>
        {events.length === 0 ? (
          <p>No events yet.</p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Event Type</th>
                <th style={th}>Payload</th>
                <th style={th}>Created At</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td style={td}>{e.eventType}</td>
                  <td style={td}>{e.payload}</td>
                  <td style={td}>{new Date(e.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

const page: CSSProperties = {
  fontFamily: "sans-serif",
  padding: "2rem",
  maxWidth: 900,
  margin: "0 auto",
};
const table: CSSProperties = { width: "100%", borderCollapse: "collapse" };
const th: CSSProperties = {
  textAlign: "left",
  borderBottom: "2px solid #ccc",
  padding: "8px",
};
const td: CSSProperties = { borderBottom: "1px solid #eee", padding: "8px" };
const formRow: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  flexWrap: "wrap",
};
const input: CSSProperties = {
  padding: "8px",
  border: "1px solid #ccc",
  borderRadius: 4,
  flex: "1 1 180px",
};
const button: CSSProperties = {
  padding: "8px 16px",
  border: "none",
  borderRadius: 4,
  background: "#2e7d8a",
  color: "#fff",
  cursor: "pointer",
};
const deleteButton: CSSProperties = {
  padding: "4px 10px",
  border: "1px solid #ccc",
  borderRadius: 4,
  background: "#fff",
  color: "crimson",
  cursor: "pointer",
};

export default App;
