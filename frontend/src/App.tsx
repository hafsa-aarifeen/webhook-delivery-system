import { useState, useEffect } from "react";

function App() {
  const [status, setStatus] = useState<string>("checking...");

  useEffect(() => {
    fetch("http://localhost:5180/health")
      .then((response) => response.json())
      .then((data) => setStatus(data.status))
      .catch(() => setStatus("could not reach the API"));
  }, []);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>Webhook Delivery System</h1>
      <p>
        Backend health: <strong>{status}</strong>
      </p>
    </div>
  );
}

export default App;
