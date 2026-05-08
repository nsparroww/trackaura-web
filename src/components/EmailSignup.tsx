"use client";

import { useState } from "react";

const SUPABASE_URL = "https://scsinqiyoxutvkopahbb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjc2lucWl5b3h1dHZrb3BhaGJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMzkyNTIsImV4cCI6MjA4ODYxNTI1Mn0.tcFRAK1x9o0Dru39jK0Soo6yeA2Xz0O0C_vm989r_VA";

export default function EmailSignup() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "exists" | "error">("idle");

  const handleSubmit = async () => {
    if (!email || !email.includes("@") || !email.includes(".")) return;
    setStatus("saving");

    try {
      const res = await fetch(SUPABASE_URL + "/rest/v1/email_subscribers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: "Bearer " + SUPABASE_KEY,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ email: email.toLowerCase().trim() }),
      });

      if (res.ok) {
        setStatus("done");
        setEmail("");
        if (typeof window !== "undefined" && (window as any).gtag) {
          (window as any).gtag("event", "email_signup", {
            event_category: "engagement",
            event_label: "catalog_updates",
          });
        }
      } else if (res.status === 409) {
        setStatus("exists");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  return (
    <div style={{ textAlign: "center", padding: "1rem 0" }}>
      <p
        style={{
          fontSize: "0.6875rem",
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.15em",
          fontWeight: 500,
          marginBottom: "0.75rem",
        }}
      >
        Stay current
      </p>
      <p
        style={{
          color: "var(--text-secondary)",
          fontSize: "0.875rem",
          marginBottom: "1.25rem",
          lineHeight: 1.6,
          maxWidth: 480,
          margin: "0 auto 1.25rem",
        }}
      >
        Set price alerts on any entry, or subscribe for periodic catalog updates by email.
      </p>

      {status === "done" ? (
        <p style={{ color: "var(--accent)", fontWeight: 500, fontSize: "0.9375rem" }}>
          {"\u2713 You're subscribed. Confirmation on its way."}
        </p>
      ) : status === "exists" ? (
        <p style={{ color: "var(--accent)", fontWeight: 500, fontSize: "0.9375rem" }}>
          {"\u2713 You're already subscribed. Set per-entry alerts on any product page."}
        </p>
      ) : (
        <div style={{ display: "flex", gap: "0.5rem", maxWidth: 420, margin: "0 auto" }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            style={{
              flex: 1,
              padding: "0.5625rem 0.875rem",
              background: "var(--bg-primary)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-primary)",
              fontSize: "0.875rem",
              outline: "none",
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={status === "saving"}
            className="btn-primary"
            style={{ whiteSpace: "nowrap", fontSize: "0.875rem", padding: "0.5625rem 1.125rem" }}
          >
            {status === "saving" ? "..." : "Subscribe"}
          </button>
        </div>
      )}

      {status === "error" && (
        <p style={{ color: "var(--danger)", fontSize: "0.8125rem", marginTop: "0.625rem" }}>
          Something went wrong. Try again.
        </p>
      )}
    </div>
  );
}
