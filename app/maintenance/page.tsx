"use client";

import Link from "next/link";

export default function MaintenancePage() {
  return (
    <main className="app-page">
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
        }}
      >
        <div className="card card-strong" style={{ marginBottom: 20 }}>
          <h1 className="app-title">🛠 Maintenance Mode</h1>

          <p
            className="meta-text"
            style={{
              marginTop: 12,
              lineHeight: 1.6,
            }}
          >
            Internal tools, diagnostics, cleanup, and future batch operations.
          </p>
        </div>

        <div className="page-header-side">
          <Link href="/" className="link-reset">
            <span className="nav-button">← Back to the Menu</span>
          </Link>
        </div>
      </div>
    </main>
  );
}