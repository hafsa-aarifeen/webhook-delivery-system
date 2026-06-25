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

interface DeliveryAttempt {
  id: string;
  eventType: string;
  subscriber: string;
  subscriberUrl: string | null;
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  errorMessage: string | null;
  attemptedAt: string;
}

interface Delivery {
  id: string;
  eventType: string;
  subscriber: string;
  status: string;
  attemptCount: number;
  nextAttemptAt: string;
  createdAt: string;
  completedAt: string | null;
}

interface TimelineAttempt {
  attemptNumber: number;
  success: boolean;
  statusCode: number | null;
  errorMessage: string | null;
  durationMs: number;
  attemptedAt: string;
}

interface Stats {
  total: number;
  delivered: number;
  deadLettered: number;
  pending: number;
  successRate: number;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:5180";

function App() {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("token"),
  );

  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");

  const [events, setEvents] = useState<EventItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [attempts, setAttempts] = useState<DeliveryAttempt[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [timelineAttempts, setTimelineAttempts] = useState<TimelineAttempt[]>(
    [],
  );

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [eventType, setEventType] = useState("");
  const [error, setError] = useState("");

  const logout = () => {
    localStorage.removeItem("token");
    setToken(null);
  };

  // Every dashboard request goes through here: it attaches the bearer token,
  // and if the server says 401 (e.g. token expired) it logs us back out.
  const authFetch = async (path: string, options: RequestInit = {}) => {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 401) {
      logout();
    }
    return res;
  };

  const handleLogin = async () => {
    setLoginError("");
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      });
      if (!res.ok) {
        setLoginError("Invalid username or password.");
        return;
      }
      const data = await res.json();
      localStorage.setItem("token", data.token);
      setToken(data.token);
      setLoginUser("");
      setLoginPass("");
    } catch {
      setLoginError("Could not reach the server.");
    }
  };

  const loadSubscriptions = () => {
    authFetch(`/subscriptions`)
      .then((r) => r.json())
      .then(setSubscriptions)
      .catch(() => setSubscriptions([]));
  };
  const loadEvents = () => {
    authFetch(`/events`)
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => setEvents([]));
  };
  const loadDeliveries = () => {
    authFetch(`/deliveries`)
      .then((r) => r.json())
      .then(setDeliveries)
      .catch(() => setDeliveries([]));
  };
  const loadAttempts = () => {
    authFetch(`/delivery-attempts`)
      .then((r) => r.json())
      .then(setAttempts)
      .catch(() => setAttempts([]));
  };
  const loadStats = () => {
    authFetch(`/deliveries/stats`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStats(null));
  };

  useEffect(() => {
    if (!token) return;
    const loadAll = () => {
      loadEvents();
      loadSubscriptions();
      loadDeliveries();
      loadAttempts();
      loadStats();
    };
    loadAll();
    const interval = setInterval(loadAll, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleAddSubscription = async () => {
    setError("");
    const res = await authFetch(`/subscriptions`, {
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
    await authFetch(`/subscriptions/${id}`, { method: "DELETE" });
    loadSubscriptions();
  };

  const handleRetry = async (id: string) => {
    await authFetch(`/deliveries/${id}/retry`, { method: "POST" });
    loadDeliveries();
  };

  const toggleTimeline = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setTimelineAttempts([]);
      return;
    }
    setExpandedId(id);
    setTimelineAttempts([]);
    try {
      const res = await authFetch(`/deliveries/${id}/attempts`);
      const data = await res.json();
      setTimelineAttempts(data);
    } catch {
      setTimelineAttempts([]);
    }
  };

  const statusColor = (status: string): string => {
    if (status === "Delivered") return "green";
    if (status === "DeadLettered") return "crimson";
    return "#b8860b"; // Pending — amber
  };

  // --- Login gate: if not authenticated, show the login form instead. ---
  if (!token) {
    return (
      <div style={loginWrap}>
        <div style={loginCard}>
          <h1 style={{ marginTop: 0 }}>Webhook Dashboard</h1>
          <p style={{ color: "#667", marginTop: 0 }}>Sign in to continue.</p>
          <input
            style={{ ...input, width: "100%", marginBottom: "0.75rem" }}
            placeholder="Username"
            value={loginUser}
            onChange={(e) => setLoginUser(e.target.value)}
          />
          <input
            style={{ ...input, width: "100%", marginBottom: "0.75rem" }}
            type="password"
            placeholder="Password"
            value={loginPass}
            onChange={(e) => setLoginPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLogin();
            }}
          />
          <button style={{ ...button, width: "100%" }} onClick={handleLogin}>
            Log in
          </button>
          {loginError && (
            <p style={{ color: "crimson", marginBottom: 0 }}>{loginError}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={headerRow}>
        <h1 style={{ margin: 0 }}>Webhook Delivery System</h1>
        <button style={logoutButton} onClick={logout}>
          Log out
        </button>
      </div>

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

      <section style={{ marginTop: "2rem" }}>
        <h2>Delivery health</h2>
        {stats ? (
          <div style={statsRow}>
            <div style={statCard}>
              <div style={statValue}>{stats.total}</div>
              <div style={statLabel}>Total</div>
            </div>
            <div style={statCard}>
              <div style={{ ...statValue, color: "green" }}>
                {stats.delivered}
              </div>
              <div style={statLabel}>Delivered</div>
            </div>
            <div style={statCard}>
              <div style={{ ...statValue, color: "crimson" }}>
                {stats.deadLettered}
              </div>
              <div style={statLabel}>Dead-lettered</div>
            </div>
            <div style={statCard}>
              <div style={{ ...statValue, color: "#b8860b" }}>
                {stats.pending}
              </div>
              <div style={statLabel}>Pending</div>
            </div>
            <div style={{ ...statCard, ...successCard }}>
              <div style={{ ...statValue, color: "#fff" }}>
                {stats.successRate}%
              </div>
              <div style={{ ...statLabel, color: "#dff5ec" }}>Success rate</div>
            </div>
          </div>
        ) : (
          <p>No stats yet.</p>
        )}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Deliveries ({deliveries.length})</h2>
        <p style={hint}>Click a row to see its attempt timeline.</p>
        {deliveries.length === 0 ? (
          <p>No deliveries yet.</p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Event</th>
                <th style={th}>Subscriber</th>
                <th style={th}>Status</th>
                <th style={th}>Attempts</th>
                <th style={th}>Created</th>
                <th style={th}>Completed</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <>
                  <tr key={d.id}>
                    <td
                      style={{ ...td, cursor: "pointer", userSelect: "none" }}
                      onClick={() => toggleTimeline(d.id)}
                    >
                      <span style={{ color: "#2e7d8a", fontWeight: 700 }}>
                        {expandedId === d.id ? "▼ " : "▶ "}
                      </span>
                      {d.eventType}
                    </td>
                    <td style={td}>{d.subscriber}</td>
                    <td
                      style={{
                        ...td,
                        color: statusColor(d.status),
                        fontWeight: 600,
                      }}
                    >
                      {d.status}
                    </td>
                    <td style={td}>{d.attemptCount}</td>
                    <td style={td}>{new Date(d.createdAt).toLocaleString()}</td>
                    <td style={td}>
                      {d.completedAt
                        ? new Date(d.completedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td style={td}>
                      {d.status === "DeadLettered" ? (
                        <button
                          style={retryButton}
                          onClick={() => handleRetry(d.id)}
                        >
                          Retry
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                  {expandedId === d.id && (
                    <tr key={d.id + "-timeline"}>
                      <td colSpan={7} style={timelineCell}>
                        {timelineAttempts.length === 0 ? (
                          <p style={{ margin: 0, color: "#777" }}>
                            Loading attempts…
                          </p>
                        ) : (
                          <div style={timeline}>
                            {timelineAttempts.map((a, i) => (
                              <div key={i} style={timelineItem}>
                                <span
                                  style={{
                                    ...dot,
                                    background: a.success ? "green" : "crimson",
                                  }}
                                />
                                <span style={{ fontWeight: 600 }}>
                                  Attempt {a.attemptNumber}
                                </span>
                                <span
                                  style={{
                                    color: a.success ? "green" : "crimson",
                                    fontWeight: 600,
                                  }}
                                >
                                  {a.success ? "Success" : "Failed"}
                                </span>
                                <span style={{ color: "#555" }}>
                                  {a.statusCode ??
                                    (a.errorMessage ? "error" : "-")}
                                </span>
                                <span style={{ color: "#555" }}>
                                  {a.durationMs} ms
                                </span>
                                <span style={{ color: "#999" }}>
                                  {new Date(a.attemptedAt).toLocaleString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Delivery Attempts ({attempts.length})</h2>
        {attempts.length === 0 ? (
          <p>No delivery attempts yet.</p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Event</th>
                <th style={th}>Subscriber</th>
                <th style={th}>Result</th>
                <th style={th}>Status</th>
                <th style={th}>Duration</th>
                <th style={th}>When</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td style={td}>{a.eventType}</td>
                  <td style={td}>{a.subscriber}</td>
                  <td
                    style={{
                      ...td,
                      color: a.success ? "green" : "crimson",
                      fontWeight: 600,
                    }}
                  >
                    {a.success ? "Success" : "Failed"}
                  </td>
                  <td style={td}>
                    {a.statusCode ?? (a.errorMessage ? "error" : "-")}
                  </td>
                  <td style={td}>{a.durationMs} ms</td>
                  <td style={td}>{new Date(a.attemptedAt).toLocaleString()}</td>
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
  maxWidth: 1000,
  margin: "0 auto",
};
const headerRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};
const loginWrap: CSSProperties = {
  fontFamily: "sans-serif",
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#f4f7f7",
};
const loginCard: CSSProperties = {
  background: "#fff",
  padding: "2rem",
  borderRadius: 12,
  border: "1px solid #e2e8e8",
  width: 320,
  boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
};
const table: CSSProperties = { width: "100%", borderCollapse: "collapse" };
const th: CSSProperties = {
  textAlign: "left",
  borderBottom: "2px solid #ccc",
  padding: "8px",
};
const td: CSSProperties = { borderBottom: "1px solid #eee", padding: "8px" };
const hint: CSSProperties = {
  margin: "0 0 0.5rem",
  color: "#888",
  fontSize: "0.85rem",
};
const statsRow: CSSProperties = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
};
const statCard: CSSProperties = {
  flex: "1 1 120px",
  border: "1px solid #e2e8e8",
  borderRadius: 8,
  padding: "16px",
  textAlign: "center",
  background: "#fafbfb",
};
const successCard: CSSProperties = {
  background: "#2e7d8a",
  border: "1px solid #2e7d8a",
};
const statValue: CSSProperties = {
  fontSize: "1.8rem",
  fontWeight: 700,
  lineHeight: 1.1,
};
const statLabel: CSSProperties = {
  marginTop: "4px",
  fontSize: "0.8rem",
  color: "#667",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
const timelineCell: CSSProperties = {
  background: "#f7fafa",
  padding: "12px 16px",
  borderBottom: "1px solid #eee",
};
const timeline: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};
const timelineItem: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "16px",
};
const dot: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: "50%",
  display: "inline-block",
};
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
const retryButton: CSSProperties = {
  padding: "4px 10px",
  border: "1px solid #2e7d8a",
  borderRadius: 4,
  background: "#2e7d8a",
  color: "#fff",
  cursor: "pointer",
};
const logoutButton: CSSProperties = {
  padding: "8px 16px",
  border: "1px solid #2e7d8a",
  borderRadius: 4,
  background: "#fff",
  color: "#2e7d8a",
  cursor: "pointer",
};

export default App;
