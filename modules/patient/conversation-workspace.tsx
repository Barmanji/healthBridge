"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import type Vapi from "@vapi-ai/web";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppointmentProposal } from "@/modules/patient/appointment-proposal";
import { CareSummaryPanel } from "@/modules/patient/care-summary-panel";
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

type ThreadSummary = { id: string; languageCode: string; status: "active" | "halted" | "closed"; title: string | null; createdAt: string };

type Props = {
  currentId: string | null;
  currentStatus: "active" | "halted" | "closed" | null;
  currentTitle: string | null;
  initialMessages: ThreadMessage[];
  threads: ThreadSummary[];
  voiceEnabled: boolean;
  preferredLanguage: string;
  triage: { id: string; summary: string; severity: "routine" | "soon" | "urgent" | "emergency"; languageCode: string } | null;
  doctorSuggestions: DoctorSuggestion[];
  appointment: { id: string; status: string; startsAt: string; endsAt: string; holdExpiresAt: string | null; consultMode: "video" | "audio"; timeZone: string } | null;
};

const fallbackMessage = "We could not safely review this message, so this chat has stopped. If you may be in immediate danger, contact local emergency services or someone you trust now.\n\nहम इस संदेश की सुरक्षित जाँच नहीं कर पाए, इसलिए यह चैट रोक दी गई है। अगर आपको तत्काल खतरा हो सकता है, तो अभी स्थानीय आपातकालीन सेवा या किसी भरोसेमंद व्यक्ति से संपर्क करें।";

// The voice opening line follows the patient's chosen language so the call does
// not start in a language they may not read. Only the greeting is localized; the
// assistant continues in whatever language the person actually speaks.
const voiceGreetings: Record<string, string> = {
  "en-IN": "Hello, I am Health-Bridge. You can speak in English or any language you are comfortable with. What has been worrying you?",
  "hi-IN": "नमस्ते, मैं हेल्थ-ब्रिज हूँ। आप हिंदी या किसी भी भाषा में बोल सकते हैं। बताइए, आपको किस बात की चिंता है?",
  "bn-IN": "নমস্কার, আমি হেলথ-ব্রিজ। আপনি বাংলা বা যেকোনো ভাষায় কথা বলতে পারেন। আপনার কী নিয়ে চিন্তা হচ্ছে?",
  "mr-IN": "नमस्कार, मी हेल्थ-ब्रिज आहे. तुम्ही मराठी किंवा कोणत्याही भाषेत बोलू शकता. तुम्हाला कशाची काळजी वाटत आहे?",
  "te-IN": "నమస్కారం, నేను హెల్త్-బ్రిడ్జ్. మీరు తెలుగు లేదా ఏ భాషలోనైనా మాట్లాడవచ్చు. మీకు ఏమి ఆందోళన కలిగిస్తోంది?",
  "ta-IN": "வணக்கம், நான் ஹெல்த்-பிரிட்ஜ். நீங்கள் தமிழ் அல்லது எந்த மொழியிலும் பேசலாம். உங்களுக்கு என்ன கவலை?",
  "gu-IN": "નમસ્તે, હું હેલ્થ-બ્રિજ છું. તમે ગુજરાતી કે કોઈપણ ભાષામાં બોલી શકો છો. તમને કઈ બાબતની ચિંતા છે?",
  "kn-IN": "ನಮಸ್ಕಾರ, ನಾನು ಹೆಲ್ತ್-ಬ್ರಿಡ್ಜ್. ನೀವು ಕನ್ನಡ ಅಥವಾ ಯಾವುದೇ ಭಾಷೆಯಲ್ಲಿ ಮಾತನಾಡಬಹುದು. ನಿಮಗೆ ಏನು ಚಿಂತೆ?",
  "ml-IN": "നമസ്കാരം, ഞാൻ ഹെൽത്ത്-ബ്രിഡ്ജ് ആണ്. നിങ്ങൾക്ക് മലയാളത്തിലോ ഏത് ഭാഷയിലോ സംസാരിക്കാം. നിങ്ങളെ എന്താണ് ആശങ്കപ്പെടുത്തുന്നത്?",
  "pa-IN": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ ਹੈਲਥ-ਬ੍ਰਿਜ ਹਾਂ। ਤੁਸੀਂ ਪੰਜਾਬੀ ਜਾਂ ਕਿਸੇ ਵੀ ਭਾਸ਼ਾ ਵਿੱਚ ਬੋਲ ਸਕਦੇ ਹੋ। ਤੁਹਾਨੂੰ ਕੀ ਚਿੰਤਾ ਹੈ?",
  "or-IN": "ନମସ୍କାର, ମୁଁ ହେଲଥ-ବ୍ରିଜ। ଆପଣ ଓଡ଼ିଆ କିମ୍ବା ଯେକୌଣସି ଭାଷାରେ କହିପାରିବେ। ଆପଣଙ୍କୁ କଣ ଚିନ୍ତା କରୁଛି?",
  "as-IN": "নমস্কাৰ, মই হেলথ-ব্ৰিজ। আপুনি অসমীয়া বা যিকোনো ভাষাত ক'ব পাৰে। আপোনাক কি চিন্তা কৰাইছে?",
  "ur-IN": "السلام علیکم، میں ہیلتھ بریج ہوں۔ آپ اردو یا کسی بھی زبان میں بول سکتے ہیں۔ آپ کو کس بات کی فکر ہے؟",
};

export function ConversationWorkspace({ currentId, currentStatus, currentTitle, initialMessages, threads, voiceEnabled, preferredLanguage, triage, doctorSuggestions, appointment }: Props) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(currentId);
  const [status, setStatus] = useState(currentStatus);
  const [title, setTitle] = useState(currentTitle);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(currentTitle ?? "");
  const [messages, setMessages] = useState(initialMessages);
  const [consent, setConsent] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [localSafetyStop, setLocalSafetyStop] = useState(false);
  const [safetyEscalated, setSafetyEscalated] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "starting" | "active">("idle");
  const [voiceCaption, setVoiceCaption] = useState("");
  const [muted, setMuted] = useState(false);
  const vapiRef = useRef<Vapi | null>(null);
  const voiceEndingRef = useRef(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  // Resume where the patient left off: on opening a saved thread, land on the
  // newest turn instead of the top of the history.
  useEffect(() => {
    if (!initialMessages.length) return;
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [initialMessages.length]);

  // A thread flagged in an earlier session must show its red light immediately
  // on open, not only after the next turn.
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/patient/conversations/${conversationId}/safety`);
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { escalated?: boolean };
        if (!cancelled) setSafetyEscalated(Boolean(payload.escalated));
      } catch {
        // Never block the conversation on a status check.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

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

  // Asks the server whether this conversation has a non-routine risk event so
  // the red in-call light can be shown without reading the transcript aloud.
  async function checkSafety() {
    if (!conversationId) return;
    try {
      const response = await fetch(`/api/patient/conversations/${conversationId}/safety`);
      if (!response.ok) return;
      const payload = (await response.json()) as { escalated?: boolean };
      setSafetyEscalated(Boolean(payload.escalated));
    } catch {
      // A failed status check must never interrupt the call or the chat.
    }
  }

  async function startVoice() {
    if (!conversationId || voiceState !== "idle" || status !== "active" || pending) return;
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
        throw new Error("Vapi needs a public HTTPS address to reach this server. Set VAPI_CALLBACK_BASE_URL to your HTTPS tunnel URL, or continue by typing.");
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
        if (role === "assistant") void checkSafety();
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
        firstMessage: voiceGreetings[preferredLanguage] ?? voiceGreetings["en-IN"],
        firstMessageMode: "assistant-speaks-first",
        // No endCallPhrases: a risky or unreviewable turn adds the red in-call
        // light and spoken emergency advice, but the patient is never hung up on.
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
      setSafetyEscalated(false);
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
      void checkSafety();
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
    setSafetyEscalated(false);
    router.replace("/patient/conversations?new=1");
  }

  async function saveTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = titleDraft.trim();
    if (!conversationId || next.length < 2) return;
    try {
      const response = await fetch(`/api/patient/conversations/${conversationId}/title`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      const payload = await response.json() as { conversation?: { title: string | null }; error?: string };
      if (!response.ok) throw new Error(payload.error || "This title could not be saved.");
      setTitle(payload.conversation?.title ?? next);
      setRenaming(false);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This title could not be saved.");
    }
  }

  return (
    <main className="grid w-full gap-6 px-4 py-7 sm:px-8 lg:grid-cols-[280px_minmax(0,1fr)] xl:px-10">
      <aside className="space-y-4">
        <Button className="min-h-11 w-full" onClick={createNewThread}>New conversation</Button>
        <section className="rounded-2xl border bg-card p-4" aria-label="Conversation history">
          <h2 className="text-sm font-semibold">Recent conversations</h2>
          {threads.length ? <ul className="mt-3 space-y-1">{threads.map((thread) => {
            const active = thread.id === conversationId;
            const halted = thread.status === "halted";
            return <li key={thread.id}><Link href={`/patient/conversations?id=${thread.id}`} className={`block rounded-xl px-3 py-2.5 text-sm ${active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}>
              {halted
                ? <span className="block line-clamp-2">Safety review</span>
                : thread.title
                  ? <span className="block line-clamp-2">{thread.title}</span>
                  : <span className="hb-title-shimmer my-1 block" aria-label="Naming this conversation" />}
              <span className="mt-1 block text-xs">
                {new Date(thread.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                {" · "}
                {new Date(thread.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </span>
            </Link></li>;
          })}</ul> : <p className="mt-2 text-sm text-muted-foreground">Your saved conversations will appear here.</p>}
        </section>
        <p className="px-1 text-xs leading-relaxed text-muted-foreground">Health-Bridge offers intake support, not a diagnosis or a substitute for a doctor or emergency services.</p>
      </aside>

      <section className="flex min-h-[70vh] flex-col overflow-hidden rounded-3xl border bg-card shadow-sm">
        <header className="border-b px-5 py-4 sm:px-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary">Any language · detected from each message</p>
              {renaming && conversationId ? <form onSubmit={saveTitle} className="mt-1 flex flex-wrap items-center gap-2">
                <label htmlFor="conversation-title" className="sr-only">Conversation title</label>
                <input id="conversation-title" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} maxLength={60} autoFocus className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-lg font-semibold" />
                <Button type="submit" size="sm" disabled={titleDraft.trim().length < 2}>Save</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setRenaming(false); setTitleDraft(title ?? ""); }}>Cancel</Button>
              </form> : <div className="mt-1 flex flex-wrap items-center gap-3">
                <h1 className="flex items-center gap-2 text-xl font-semibold">
                  {title
                    ? title
                    : status === "halted"
                      ? "Safety review"
                      : conversationId
                        ? <span className="hb-title-shimmer" aria-label="Naming this conversation" />
                        : "New conversation"}
                </h1>
                {conversationId && <Button type="button" size="sm" variant="ghost" onClick={() => { setTitleDraft(title ?? ""); setRenaming(true); }}>Rename</Button>}
              </div>}
              <p className="mt-1 text-sm text-muted-foreground">Type naturally in any language, including a mix. The language is detected from each message.</p>
            </div>
            {safetyEscalated && <p className="flex shrink-0 items-center gap-2 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive" role="status">
              <span className="hb-alert-blink size-2 rounded-full bg-destructive" aria-hidden="true" />
              Safety alert
            </p>}
          </div>
        </header>

        {!conversationId ? (
          <div className="m-auto w-full max-w-3xl p-5 sm:p-8">
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
          <Tabs defaultValue="conversation" className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="border-b px-4 sm:px-6">
              <TabsList variant="line">
                <TabsTrigger value="conversation">Conversation</TabsTrigger>
                <TabsTrigger value="summary">Summary</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="conversation" className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-7" aria-live="polite" aria-relevant="additions text">
                {!messages.length && <div className="mx-auto mt-12 max-w-2xl rounded-2xl bg-muted/40 p-5 text-center"><p className="font-medium">नमस्ते — how can I help you get ready to speak with a doctor?</p><p className="mt-2 text-sm text-muted-foreground">Tell me what is bothering you. You can switch languages at any time.</p></div>}
                {messages.map((message) => <article key={message.id} className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[76%] ${message.role === "patient" ? "ml-auto rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-background"}`}>
                  <p className="mb-1 flex flex-wrap items-center gap-x-2 text-[11px] font-semibold opacity-70">
                    <span>{message.role === "patient" ? "You" : "Health-Bridge · AI intake"}{message.modality === "voice" ? " · voice" : ""}{message.languageCode ? ` · ${message.languageCode}` : ""}</span>
                    <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time>
                  </p>
                  <p>{message.content}</p>
                  {message.role === "patient" && message.contentEnglish && message.contentEnglish !== message.content && <details className="mt-2 border-t border-current/20 pt-2 text-xs"><summary className="cursor-pointer">English translation</summary><p className="mt-1">{message.contentEnglish}</p></details>}
                </article>)}
                {pending && <p className="text-sm text-muted-foreground" role="status">Checking this message safely…</p>}
                {safetyEscalated && status !== "halted" && <div role="status" className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm leading-6">
                  <span className="hb-alert-blink mt-1.5 size-2.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-destructive">This conversation has been flagged for safety.</p>
                    <p className="mt-1">You can keep talking — this chat stays open. But please do not wait for this app: contact local emergency services or someone you trust now if you may be in immediate danger.</p>
                    <p className="mt-1" lang="hi">अगर आपको तत्काल खतरा हो सकता है, तो अभी स्थानीय आपातकालीन सेवा या किसी भरोसेमंद व्यक्ति से संपर्क करें। इस ऐप का इंतज़ार न करें।</p>
                  </div>
                </div>}
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
                {/* Anchor used to resume at the newest turn when a saved thread opens. */}
                <div ref={threadEndRef} aria-hidden="true" />
              </div>
              <form onSubmit={sendMessage} className="border-t bg-card p-3 sm:p-4">
                <label htmlFor="conversation-message" className="sr-only">Write your health message</label>
                <div className="flex items-end gap-2">
                  <Textarea id="conversation-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1800} rows={2} placeholder="Type in Hindi, English, or a mix…" disabled={pending || status !== "active" || localSafetyStop} className="max-h-40 min-h-12 flex-1" />
                  {voiceEnabled && <Button type="button" variant={voiceState === "active" ? "destructive" : "outline"} className="min-h-11" disabled={pending || status !== "active" || localSafetyStop || voiceState === "starting"} onClick={() => voiceState === "active" ? void stopVoice() : void startVoice()} aria-label={voiceState === "active" ? "End voice conversation" : "Start voice conversation"}>{voiceState === "starting" ? "Starting…" : voiceState === "active" ? "End voice" : "Mic"}</Button>}
                  <Button type="submit" className="min-h-11" disabled={pending || !draft.trim() || status !== "active" || localSafetyStop}>Send</Button>
                </div>
                {voiceEnabled && voiceState === "active" && <div className="mt-3 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2" role="status" aria-live="polite">
                  <span className="hb-voice-bars shrink-0" aria-hidden="true"><span /><span /><span /><span /><span /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-primary">{muted ? "Microphone muted" : "Listening — speak in any language"}</p>
                    <p className="truncate text-xs text-muted-foreground">{voiceCaption || "Waiting for you to speak."}</p>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => { const nextMuted = !muted; vapiRef.current?.setMuted(nextMuted); setMuted(nextMuted); }}>{muted ? "Unmute" : "Mute"}</Button>
                </div>}
                {voiceEnabled && voiceState !== "active" && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Press Mic to speak. Live audio is transcribed by Vapi and reviewed by OpenAI for language and safety, then saved to this account. Call recording and Vapi transcript archives stay off for this session.
                </p>}
                {voiceEnabled && voiceState !== "active" && voiceCaption && <p className="mt-1 text-xs text-foreground" aria-live="polite">{voiceCaption}</p>}
                <p className="mt-2 flex justify-between gap-2 text-xs text-muted-foreground"><span>Messages are checked one at a time; repeated submissions are deduplicated.</span><span>{draft.length}/1800</span></p>
              </form>
            </TabsContent>

            <TabsContent value="summary" className="flex min-h-0 flex-1 flex-col">
              <CareSummaryPanel key={`${conversationId}:${triage?.id ?? "none"}`} conversationId={conversationId} />
            </TabsContent>
          </Tabs>
        )}
      </section>
    </main>
  );
}
