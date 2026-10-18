"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import type Vapi from "@vapi-ai/web";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AppointmentProposal } from "@/modules/patient/appointment-proposal";
import type { DoctorSuggestion } from "@/modules/patient/matching";

type ThreadMessage = {
  id: string;
  role: "patient" | "assistant" | "system";
  modality: "text" | "voice";
  content: string;
  contentEnglish: string | null;
  languageCode: string | null;
  createdAt: string;
};

type ThreadSummary = { id: string; languageCode: string; status: "active" | "halted" | "closed"; createdAt: string };

type Props = {
  currentId: string | null;
  currentStatus: "active" | "halted" | "closed" | null;
  initialMessages: ThreadMessage[];
  threads: ThreadSummary[];
  voiceEnabled: boolean;
  triage: { id: string; summary: string; severity: "routine" | "soon" | "urgent" | "emergency"; languageCode: string } | null;
  doctorSuggestions: DoctorSuggestion[];
  appointment: { id: string; status: string; startsAt: string; endsAt: string; holdExpiresAt: string | null; consultMode: "video" | "audio"; timeZone: string } | null;
};

const fallbackMessage = "We could not safely review this message, so this chat has stopped. If you may be in immediate danger, contact local emergency services or someone you trust now.\n\nहम इस संदेश की सुरक्षित जाँच नहीं कर पाए, इसलिए यह चैट रोक दी गई है। अगर आपको तत्काल खतरा हो सकता है, तो अभी स्थानीय आपातकालीन सेवा या किसी भरोसेमंद व्यक्ति से संपर्क करें।";

export function ConversationWorkspace({ currentId, currentStatus, initialMessages, threads, voiceEnabled, triage, doctorSuggestions, appointment }: Props) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(currentId);
  const [status, setStatus] = useState(currentStatus);
  const [messages, setMessages] = useState(initialMessages);
  const [consent, setConsent] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [localSafetyStop, setLocalSafetyStop] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "starting" | "active">("idle");
  const [voiceCaption, setVoiceCaption] = useState("");
  const [muted, setMuted] = useState(false);
  const vapiRef = useRef<Vapi | null>(null);
  const voiceEndingRef = useRef(false);

  async function revokeVoiceSession() {
    if (!conversationId) return;
    try {
      await fetch(`/api/patient/conversations/${conversationId}/voice-session`, { method: "DELETE" });
    } catch {
      // Session credentials also expire after 15 minutes if a disconnect prevents revocation.
    }
  }

  async function stopVoice() {
    if (voiceEndingRef.current) return;
    voiceEndingRef.current = true;
    const client = vapiRef.current;
    vapiRef.current = null;
    try { await client?.stop(); } catch { /* stopping a disconnected call is already complete */ }
    await revokeVoiceSession();
    setVoiceState("idle");
    setMuted(false);
    voiceEndingRef.current = false;
  }

  async function startVoice() {
    if (!conversationId || !voiceConsent || voiceState !== "idle" || status !== "active" || pending) return;
    setVoiceState("starting");
    setError("");
    setVoiceCaption("");
    try {
      const sessionResponse = await fetch(`/api/patient/conversations/${conversationId}/voice-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceProcessingConsent: true }),
      });
      const sessionData = await sessionResponse.json() as {
        token?: string; publicKey?: string; assistantId?: string; apiBaseUrl?: string; error?: string;
      };
      if (!sessionResponse.ok || !sessionData.token || !sessionData.publicKey || !sessionData.assistantId || !sessionData.apiBaseUrl) {
        throw new Error(sessionData.error || "Voice mode is not ready. You can continue by typing.");
      }
      const endpoint = new URL(sessionData.apiBaseUrl);
      if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(endpoint.hostname)) {
        throw new Error("Voice mode needs a secure HTTPS address. You can continue by typing.");
      }
      if (["localhost", "127.0.0.1"].includes(endpoint.hostname)) {
        throw new Error("Vapi needs a public HTTPS address to reach this server. Set NEXT_PUBLIC_APP_URL to your HTTPS tunnel URL, or continue by typing.");
      }

      const { default: VapiClient } = await import("@vapi-ai/web");
      const client = new VapiClient(sessionData.publicKey);
      vapiRef.current = client;
      client.on("call-start", () => setVoiceState("active"));
      client.on("call-end", () => {
        vapiRef.current = null;
        setVoiceState("idle");
        setMuted(false);
        void revokeVoiceSession();
        router.refresh();
      });
      client.on("message", (event: unknown) => {
        if (typeof event !== "object" || event === null || !("type" in event) || event.type !== "transcript") return;
        if (!("transcriptType" in event) || event.transcriptType !== "final" || !("transcript" in event) || typeof event.transcript !== "string") return;
        const transcript = event.transcript.trim();
        if (!transcript || !("role" in event) || (event.role !== "user" && event.role !== "assistant")) return;
        const role = event.role;
        setVoiceCaption(`${role === "user" ? "You" : "Health-Bridge"}: ${transcript}`);
        setMessages((previous) => [...previous, {
          id: `vapi-${crypto.randomUUID()}`,
          role: role === "user" ? "patient" : "assistant",
          modality: "voice",
          content: transcript,
          contentEnglish: null,
          languageCode: null,
          createdAt: new Date().toISOString(),
        }]);
        if (role === "assistant" && transcript.startsWith("This conversation has stopped for safety.")) {
          setStatus("halted");
          setLocalSafetyStop(true);
        }
      });
      client.on("error", () => {
        setError("Voice mode stopped. You can continue by typing; if you may be in immediate danger, contact local emergency services or someone you trust now.");
        void stopVoice();
      });

      const call = await client.start(sessionData.assistantId, {
        model: {
          provider: "custom-llm",
          model: "health-bridge-intake",
          url: `${sessionData.apiBaseUrl}/chat/completions`,
          metadataSendMode: "destructured",
          headers: { "X-Health-Bridge-Voice-Session": sessionData.token },
          temperature: 0,
          maxTokens: 450,
          timeoutSeconds: 18,
        },
        transcriber: { provider: "deepgram", model: "nova-3", language: "multi" },
        voice: { provider: "vapi", voiceId: "Naina", version: "2", language: "auto" },
        firstMessage: "नमस्ते। आप हिंदी या किसी भी भाषा में बोल सकते हैं। बताइए, आपको किस बात की चिंता है?",
        firstMessageMode: "assistant-speaks-first",
        endCallPhrases: ["This conversation has stopped for safety."],
        artifactPlan: { recordingEnabled: false, loggingEnabled: false, transcriptPlan: { enabled: false } },
      });
      if (!call) throw new Error("Voice mode could not connect. You can continue by typing.");
      setVoiceState("active");
    } catch (reason) {
      vapiRef.current = null;
      await revokeVoiceSession();
      setVoiceState("idle");
      setError(reason instanceof Error ? reason.message : "Voice mode could not start. You can continue by typing.");
    }
  }

  async function startConversation() {
    if (!consent || starting) return;
    setStarting(true);
    setError("");
    try {
      const response = await fetch("/api/patient/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiProcessingConsent: true }),
      });
      const payload = await response.json() as { conversation?: ThreadSummary; error?: string };
      if (!response.ok || !payload.conversation) throw new Error(payload.error || "Could not start this conversation.");
      setConversationId(payload.conversation.id);
      setStatus("active");
      setMessages([]);
      setLocalSafetyStop(false);
      router.replace(`/patient/conversations?id=${payload.conversation.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start this conversation.");
    } finally {
      setStarting(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!conversationId || !content || pending || status !== "active" || localSafetyStop) return;
    if (!navigator.onLine) {
      setError("You appear to be offline. This message was not sent. If you may be in immediate danger, contact local emergency services or someone you trust now.");
      return;
    }

    if (vapiRef.current) await stopVoice();

    setPending(true);
    setDraft("");
    setError("");
    const clientMessageId = crypto.randomUUID();
    const optimistic: ThreadMessage = {
      id: clientMessageId,
      role: "patient",
      modality: "text",
      content,
      contentEnglish: null,
      languageCode: "und",
      createdAt: new Date().toISOString(),
    };
    setMessages((previous) => [...previous, optimistic]);
    try {
      const response = await fetch(`/api/patient/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientMessageId, content, modality: "text", languageCode: "und" }),
      });
      const payload = await response.json() as {
        kind?: string;
        patientMessage?: ThreadMessage;
        assistantMessage?: ThreadMessage | null;
        status?: "active" | "halted";
        error?: string;
      };
      if (!response.ok) {
        setMessages((previous) => previous.filter((message) => message.id !== clientMessageId));
        if (response.status >= 500) {
          setLocalSafetyStop(true);
          setStatus("halted");
          setMessages((previous) => [...previous, {
            id: crypto.randomUUID(), role: "assistant", modality: "text", content: fallbackMessage,
            contentEnglish: null, languageCode: "hi-IN", createdAt: new Date().toISOString(),
          }]);
        }
        throw new Error(payload.error || "Your message could not be processed.");
      }

      const savedMessages = [payload.patientMessage, payload.assistantMessage].filter((message): message is ThreadMessage => Boolean(message));
      setMessages((previous) => [...previous.filter((message) => message.id !== clientMessageId), ...savedMessages]);
      setStatus(payload.status ?? "active");
      if (payload.status === "halted") setLocalSafetyStop(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your message could not be processed.");
    } finally {
      setPending(false);
    }
  }

  async function createNewThread() {
    if (vapiRef.current) await stopVoice();
    setConversationId(null);
    setStatus(null);
    setMessages([]);
    setConsent(false);
    setError("");
    setLocalSafetyStop(false);
    router.replace("/patient/conversations?new=1");
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-7 sm:px-8 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <Button className="min-h-11 w-full" onClick={createNewThread}>New conversation</Button>
        <section className="rounded-2xl border bg-card p-4" aria-label="Conversation history">
          <h2 className="text-sm font-semibold">Recent conversations</h2>
          {threads.length ? <ul className="mt-3 space-y-1">{threads.map((thread) => (
            <li key={thread.id}><Link href={`/patient/conversations?id=${thread.id}`} className={`block rounded-xl px-3 py-2.5 text-sm ${thread.id === conversationId ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}>
              <span className="block">{thread.status === "halted" ? "Safety review" : "Health conversation"}</span>
              <span className="mt-1 block text-xs">{new Date(thread.createdAt).toLocaleDateString()}</span>
            </Link></li>
          ))}</ul> : <p className="mt-2 text-sm text-muted-foreground">Your saved conversations will appear here.</p>}
        </section>
        <p className="px-1 text-xs leading-relaxed text-muted-foreground">Health-Bridge offers intake support, not a diagnosis or a substitute for a doctor or emergency services.</p>
      </aside>

      <section className="flex min-h-[70vh] flex-col overflow-hidden rounded-3xl border bg-card shadow-sm">
        <header className="border-b px-5 py-4 sm:px-7">
          <p className="text-sm font-semibold text-primary">Hindi first · switches with your message</p>
          <h1 className="mt-1 text-xl font-semibold">Health conversation</h1>
          <p className="mt-1 text-sm text-muted-foreground">Type naturally in Hindi, English, or a mix. The language is detected from each message.</p>
        </header>

        {!conversationId ? (
          <div className="m-auto w-full max-w-xl p-5 sm:p-8">
            <div className="rounded-2xl border bg-muted/30 p-5 sm:p-7">
              <p className="text-sm font-semibold text-primary">Before you begin</p>
              <h2 className="mt-2 text-xl font-semibold">A private, continuous intake thread</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Your messages are saved to your account and sent to OpenAI to detect language, translate, check for urgent risk, and prepare a brief response. The assistant does not diagnose or prescribe. If the safety check fails, this conversation stops and asks you to contact a person.</p>
              <label className="mt-5 flex cursor-pointer gap-3 rounded-xl border bg-background p-4 text-sm leading-6">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 size-4 accent-primary" />
                <span>I understand that my health messages will be processed by OpenAI and saved in this account for this conversation.</span>
              </label>
              {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
              <Button className="mt-5 min-h-11 w-full" disabled={!consent || starting} onClick={startConversation}>{starting ? "Starting…" : "Start conversation"}</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-7" aria-live="polite" aria-relevant="additions text">
              {!messages.length && <div className="mx-auto mt-12 max-w-lg rounded-2xl bg-muted/40 p-5 text-center"><p className="font-medium">नमस्ते — how can I help you get ready to speak with a doctor?</p><p className="mt-2 text-sm text-muted-foreground">Tell me what is bothering you. You can switch languages at any time.</p></div>}
              {messages.map((message) => <article key={message.id} className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[76%] ${message.role === "patient" ? "ml-auto rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-background"}`}>
                <p className="mb-1 text-[11px] font-semibold opacity-70">{message.role === "patient" ? "You" : "Health-Bridge · AI intake"}{message.modality === "voice" ? " · voice" : ""}{message.languageCode ? ` · ${message.languageCode}` : ""}</p>
                <p>{message.content}</p>
                {message.role === "patient" && message.contentEnglish && message.contentEnglish !== message.content && <details className="mt-2 border-t border-current/20 pt-2 text-xs"><summary className="cursor-pointer">English translation</summary><p className="mt-1">{message.contentEnglish}</p></details>}
              </article>)}
              {pending && <p className="text-sm text-muted-foreground" role="status">Checking this message safely…</p>}
              {(status === "halted" || localSafetyStop) && <div role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-sm leading-6"><p className="font-semibold text-destructive">This conversation has stopped for safety.</p><p className="mt-2">If you may be in immediate danger, contact local emergency services or someone you trust now. Do not wait for this app.</p><p className="mt-2" lang="hi">अगर आपको तत्काल खतरा हो सकता है, तो अभी स्थानीय आपातकालीन सेवा या किसी भरोसेमंद व्यक्ति से संपर्क करें। इस ऐप का इंतज़ार न करें।</p></div>}
              {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
              {conversationId && status !== "halted" && <AppointmentProposal
                key={`triage-${conversationId}`}
                conversationId={conversationId}
                initialTriage={triage}
                initialSuggestions={doctorSuggestions}
                initialAppointment={appointment}
              />}
              {status === "halted" && triage?.severity === "emergency" && <AppointmentProposal
                key={`emergency-${conversationId}`}
                conversationId={conversationId ?? ""}
                initialTriage={triage}
                initialSuggestions={[]}
                requiresEmergencyHelp
              />}
            </div>
            <form onSubmit={sendMessage} className="border-t bg-background/80 p-3 sm:p-5">
              <label htmlFor="conversation-message" className="sr-only">Write your health message</label>
              <div className="flex items-end gap-2">
                <Textarea id="conversation-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1800} rows={2} placeholder="Type in Hindi, English, or a mix…" disabled={pending || status !== "active" || localSafetyStop} className="max-h-40 min-h-12 flex-1" />
                {voiceEnabled && <Button type="button" variant={voiceState === "active" ? "destructive" : "outline"} className="min-h-11" disabled={pending || status !== "active" || localSafetyStop || voiceState === "starting" || !voiceConsent} onClick={() => voiceState === "active" ? void stopVoice() : void startVoice()} aria-label={voiceState === "active" ? "End voice conversation" : "Start voice conversation"}>{voiceState === "starting" ? "Starting…" : voiceState === "active" ? "End voice" : "Mic"}</Button>}
                <Button type="submit" className="min-h-11" disabled={pending || !draft.trim() || status !== "active" || localSafetyStop}>Send</Button>
              </div>
              {voiceEnabled && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 p-3">
                <label className="flex max-w-2xl cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted-foreground"><input type="checkbox" checked={voiceConsent} onChange={(event) => setVoiceConsent(event.target.checked)} className="mt-0.5 size-4 accent-primary" disabled={voiceState !== "idle"} /><span>I consent to Vapi processing live audio for transcription and speech. The transcript is sent to OpenAI for language and safety review, then saved in this account. Call recording and Vapi transcript artifacts are disabled for this session.</span></label>
                {voiceState === "active" && <Button type="button" size="sm" variant="outline" onClick={() => { const nextMuted = !muted; vapiRef.current?.setMuted(nextMuted); setMuted(nextMuted); }}>{muted ? "Unmute" : "Mute"}</Button>}
                {voiceCaption && <p className="w-full text-xs text-foreground" aria-live="polite">{voiceCaption}</p>}
              </div>}
              <p className="mt-2 flex justify-between gap-2 text-xs text-muted-foreground"><span>Messages are checked one at a time; repeated submissions are deduplicated.</span><span>{draft.length}/1800</span></p>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
