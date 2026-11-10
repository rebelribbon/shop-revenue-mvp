"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { WorkspaceIcon } from "./workspace-icon";

type HandoffNotice = { id: string; jobId: string; title: string };

// Refresh the private inbox without reloading the RO or interrupting unsaved
// inspection/pricing fields. No browser permission or external delivery is needed.
export function RoHandoffNotifications() {
  const [tasks, setTasks] = useState<HandoffNotice[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || controller) return;
      controller = new AbortController();
      try {
        const response = await fetch("/api/ro-handoffs", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401 || response.status === 403) {
          known.current = null;
          setTasks([]);
          setAnnouncement("");
          setUnavailable(true);
          return;
        }
        if (!response.ok) throw new Error("unavailable");
        const data = (await response.json()) as { tasks: HandoffNotice[] };
        if (!active) return;
        const incoming = data.tasks.filter(
          (task) => !known.current?.has(task.id),
        );
        if (known.current && incoming.length)
          setAnnouncement(
            `${incoming.length} new assigned task${incoming.length === 1 ? "" : "s"}. ${incoming[0].title}`,
          );
        known.current = new Set(data.tasks.map((task) => task.id));
        setTasks(data.tasks);
        setUnavailable(false);
      } catch {
        if (active) setUnavailable(true);
      } finally {
        controller = null;
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return (
    <div className="ro-handoff-notifications">
      <Link
        className="btn secondary"
        href="/app/tasks"
        title={announcement || "Your assigned repair orders"}
        aria-label={`Assigned work: ${tasks.length} waiting${unavailable ? ", updates unavailable" : ""}`}
      >
        <WorkspaceIcon name="tasks" />
        <span className="handoff-label">Assigned work</span>
        {tasks.length > 0 && <span aria-hidden="true">{tasks.length}</span>}
        {unavailable && <span aria-hidden="true">!</span>}
      </Link>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
