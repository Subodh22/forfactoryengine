"use client";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useJobs } from "@/lib/data";

function showNotification(title: string, status: "completed" | "failed") {
  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(`Job ${status === "completed" ? "completed ✓" : "failed ✗"}`, { body: title });
      return;
    } catch { /* fall through to toast */ }
  }
  if (status === "completed") toast.success("Job completed", { description: title });
  else toast.error("Job failed", { description: title });
}

/** Invisible component: desktop popup (or toast) when a job finishes while a tab
 *  is open. Renders nothing. */
export function JobNotifications() {
  const jobs = useJobs();
  const prevStatus = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") Notification.requestPermission().catch(() => {});
  }, []);

  useEffect(() => {
    const next = new Map(jobs.map((j) => [j.id, j.status]));
    const prev = prevStatus.current;
    if (prev === null) { prevStatus.current = next; return; }
    for (const j of jobs) {
      const was = prev.get(j.id);
      if (was && was !== j.status && (j.status === "completed" || j.status === "failed")) {
        showNotification(j.title, j.status);
      }
    }
    prevStatus.current = next;
  }, [jobs]);

  return null;
}
