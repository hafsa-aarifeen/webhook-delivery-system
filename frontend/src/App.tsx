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
    if (status === "Delivered") return "#1a7f4b";
    if (status === "DeadLettered") return "#c0392b";
    return "#b8860b"; // Pending — amber
  };

  const zebra = (i: number): CSSProperties => ({
    background: i % 2 === 1 ? "#f8fbfb" : "#ffffff",
  });

  // --- Login gate ---
  if (!token) {
    return (
      <div style={loginWrap}>
        <div style={loginCard}>
          <div style={loginBadge}>WD</div>
          <h1 style={{ margin: "0.75rem 0 0.25rem", fontSize: "1.35rem" }}>
            Webhook Dashboard
          </h1>
          <p style={{ color: "#64777b", marginTop: 0, fontSize: "0.9rem" }}>
            Sign in to manage deliveries.
          </p>
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
            <p style={{ color: "#c0392b", marginBottom: 0 }}>{loginError}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <div style={page}>
        <div style={headerBand}>
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}
          >
            <div style={headerBadge}>WD</div>
            <h1 style={{ margin: 0, fontSize: "1.25rem" }}>
              Webhook Delivery System
            </h1>
          </div>
          <button style={logoutButton} onClick={logout}>
            Log out
          </button>
        </div>

        <section style={sectionCard}>
          <h2 style={h2Style}>Add a subscription</h2>
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
            <p style={{ color: "#c0392b", marginTop: "0.5rem" }}>{error}</p>
          )}
        </section>

        <section style={sectionCard}>
          <h2 style={h2Style}>Subscriptions ({subscriptions.length})</h2>
          {subscriptions.length === 0 ? (
            <p style={emptyText}>No subscriptions yet.</p>
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
                {subscriptions.map((s, i) => (
                  <tr key={s.id} style={zebra(i)}>
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

        <section style={sectionCard}>
          <h2 style={h2Style}>Events ({events.length})</h2>
          {events.length === 0 ? (
            <p style={emptyText}>No events yet.</p>
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
                {events.map((e, i) => (
                  <tr key={e.id} style={zebra(i)}>
                    <td style={td}>{e.eventType}</td>
                    <td style={td}>{e.payload}</td>
                    <td style={td}>{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section style={sectionCard}>
          <h2 style={h2Style}>Delivery health</h2>
          {stats ? (
            <div style={statsRow}>
              <div style={statCard}>
                <div style={statValue}>{stats.total}</div>
                <div style={statLabel}>Total</div>
              </div>
              <div style={statCard}>
                <div style={{ ...statValue, color: "#1a7f4b" }}>
                  {stats.delivered}
                </div>
                <div style={statLabel}>Delivered</div>
              </div>
              <div style={statCard}>
                <div style={{ ...statValue, color: "#c0392b" }}>
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
                <div style={{ ...statLabel, color: "#dff5ec" }}>
                  Success rate
                </div>
              </div>
            </div>
          ) : (
            <p style={emptyText}>No stats yet.</p>
          )}
        </section>

        <section style={sectionCard}>
          <h2 style={h2Style}>Deliveries ({deliveries.length})</h2>
          <p style={hint}>Click a row to see its attempt timeline.</p>
          {deliveries.length === 0 ? (
            <p style={emptyText}>No deliveries yet.</p>
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
                {deliveries.map((d, i) => (
                  <>
                    <tr
                      key={d.id}
                      style={
                        expandedId === d.id
                          ? { background: "#eef5f6" }
                          : zebra(i)
                      }
                    >
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
                      <td style={td}>
                        {new Date(d.createdAt).toLocaleString()}
                      </td>
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
                              {timelineAttempts.map((a, j) => (
                                <div key={j} style={timelineItem}>
                                  <span
                                    style={{
                                      ...dot,
                                      background: a.success
                                        ? "#1a7f4b"
                                        : "#c0392b",
                                    }}
                                  />
                                  <span style={{ fontWeight: 600 }}>
                                    Attempt {a.attemptNumber}
                                  </span>
                                  <span
                                    style={{
                                      color: a.success ? "#1a7f4b" : "#c0392b",
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

        <section style={sectionCard}>
          <h2 style={h2Style}>Delivery Attempts ({attempts.length})</h2>
          {attempts.length === 0 ? (
            <p style={emptyText}>No delivery attempts yet.</p>
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
                {attempts.map((a, i) => (
                  <tr key={a.id} style={zebra(i)}>
                    <td style={td}>{a.eventType}</td>
                    <td style={td}>{a.subscriber}</td>
                    <td
                      style={{
                        ...td,
                        color: a.success ? "#1a7f4b" : "#c0392b",
                        fontWeight: 600,
                      }}
                    >
                      {a.success ? "Success" : "Failed"}
                    </td>
                    <td style={td}>
                      {a.statusCode ?? (a.errorMessage ? "error" : "-")}
                    </td>
                    <td style={td}>{a.durationMs} ms</td>
                    <td style={td}>
                      {new Date(a.attemptedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

const shell: CSSProperties = {
  fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  background: "#eef3f4",
  minHeight: "100vh",
  color: "#1f2d30",
};
const page: CSSProperties = {
  maxWidth: 1080,
  margin: "0 auto",
  padding: "0 1.5rem 3rem",
};
const headerBand: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "#2e7d8a",
  color: "#fff",
  padding: "1.1rem 1.5rem",
  borderRadius: 12,
  margin: "1.5rem 0 0.5rem",
  boxShadow: "0 3px 12px rgba(46,125,138,0.28)",
};
const headerBadge: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  background: "rgba(255,255,255,0.18)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  fontSize: "0.85rem",
  letterSpacing: "0.04em",
};
const sectionCard: CSSProperties = {
  background: "#fff",
  border: "1px solid #e3e9ea",
  borderRadius: 12,
  padding: "1.1rem 1.25rem 1.25rem",
  marginTop: "1.25rem",
  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
};
const h2Style: CSSProperties = {
  fontSize: "1.05rem",
  fontWeight: 700,
  color: "#23606b",
  borderLeft: "4px solid #2e7d8a",
  paddingLeft: "0.6rem",
  margin: "0 0 0.85rem",
};
const emptyText: CSSProperties = { color: "#8a9a9d", margin: 0 };
const table: CSSProperties = { width: "100%", borderCollapse: "collapse" };
const th: CSSProperties = {
  textAlign: "left",
  background: "#eef5f6",
  color: "#4a5d61",
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  borderBottom: "2px solid #2e7d8a",
  padding: "10px 8px",
};
const td: CSSProperties = {
  borderBottom: "1px solid #eef1f2",
  padding: "10px 8px",
  fontSize: "0.9rem",
};
const hint: CSSProperties = {
  margin: "0 0 0.5rem",
  color: "#8a9a9d",
  fontSize: "0.82rem",
};
const statsRow: CSSProperties = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
};
const statCard: CSSProperties = {
  flex: "1 1 120px",
  borderRadius: 10,
  padding: "16px",
  textAlign: "center",
  background: "#f3f8f8",
};
const successCard: CSSProperties = {
  background: "#2e7d8a",
  boxShadow: "0 2px 8px rgba(46,125,138,0.25)",
};
const statValue: CSSProperties = {
  fontSize: "1.8rem",
  fontWeight: 700,
  lineHeight: 1.1,
};
const statLabel: CSSProperties = {
  marginTop: "4px",
  fontSize: "0.72rem",
  color: "#64777b",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};
const timelineCell: CSSProperties = {
  background: "#f3f8f8",
  padding: "12px 16px",
  borderBottom: "1px solid #eef1f2",
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
  fontSize: "0.88rem",
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
  padding: "9px 10px",
  border: "1px solid #cdd8d9",
  borderRadius: 6,
  flex: "1 1 180px",
  fontSize: "0.9rem",
};
const button: CSSProperties = {
  padding: "9px 18px",
  border: "none",
  borderRadius: 6,
  background: "#2e7d8a",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 600,
};
const deleteButton: CSSProperties = {
  padding: "5px 12px",
  border: "1px solid #e0c4c4",
  borderRadius: 6,
  background: "#fff",
  color: "#c0392b",
  cursor: "pointer",
};
const retryButton: CSSProperties = {
  padding: "5px 12px",
  border: "1px solid #2e7d8a",
  borderRadius: 6,
  background: "#2e7d8a",
  color: "#fff",
  cursor: "pointer",
};
const logoutButton: CSSProperties = {
  padding: "8px 16px",
  border: "1px solid rgba(255,255,255,0.6)",
  borderRadius: 6,
  background: "transparent",
  color: "#fff",
  cursor: "pointer",
};
const loginWrap: CSSProperties = {
  fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#eef3f4",
};
const loginCard: CSSProperties = {
  background: "#fff",
  padding: "2rem",
  borderRadius: 14,
  border: "1px solid #e3e9ea",
  width: 320,
  textAlign: "center",
  boxShadow: "0 8px 30px rgba(35,96,107,0.12)",
};
const loginBadge: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 12,
  background: "#2e7d8a",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  margin: "0 auto",
};

export default App;
