"use client";
import { useState } from "react";
import { reviewDoctorApplication } from "@/modules/doctor/actions";

export function ReviewControls({ doctorId }: { doctorId: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(decision: "start_review" | "approve" | "request_info" | "reject") {
    setBusy(true);
    const input = decision === "request_info" ? { decision, doctorId, message } : decision === "reject" ? { decision, doctorId, reason: message } : { decision, doctorId };
    const result = await reviewDoctorApplication(input);
    setMessage(result.ok ? "Review decision saved." : result.message);
    setBusy(false);
  }
  return <section className="space-y-3 rounded-2xl border p-5"><h2 className="text-xl font-semibold">Review decision</h2><textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Required for request info or reject" className="min-h-24 w-full rounded-xl border bg-background p-3"/><div className="flex flex-wrap gap-2">{(["start_review", "approve", "request_info", "reject"] as const).map((decision) => <button disabled={busy || (["request_info", "reject"].includes(decision) && !message.trim())} onClick={() => act(decision)} key={decision} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{decision.replaceAll("_", " ")}</button>)}</div>{message && <p role="status" className="text-sm">{message}</p>}</section>;
}
