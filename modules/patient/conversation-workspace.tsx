"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type Vapi from "@vapi-ai/web";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppointmentProposal } from "@/modules/patient/appointment-proposal";
import { CareSummaryPanel, SoapNotePreview } from "@/modules/patient/care-summary-panel";
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
  soap: { subjective: string; objective: string; assessment: string; plan: string } | null;
  doctorSuggestions: DoctorSuggestion[];
  appointment: { id: string; status: string; startsAt: string; endsAt: string; holdExpiresAt: string | null; consultMode: "video" | "audio"; timeZone: string } | null;
};

function mergeTranscriptParts(previous: string, next: string) {
  const left = previous.trim();
  const right = next.trim();
  if (!left) return right;
  if (!right || left.includes(right)) return left;
  if (right.includes(left)) return right;
  const leftWords = left.split(/\s+/);
  const rightWords = right.split(/\s+/);
  const maxOverlap = Math.min(leftWords.length, rightWords.length, 12);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const leftEnd = leftWords.slice(-overlap).join(" ").toLocaleLowerCase();
    const rightStart = rightWords.slice(0, overlap).join(" ").toLocaleLowerCase();
    if (leftEnd === rightStart) return [...leftWords, ...rightWords.slice(overlap)].join(" ");
  }
  return `${left} ${right}`;
}

// The voice opening line follows the patient's chosen language so the call does
// not start in a language they may not read. Only the greeting is localized; the
// assistant continues in whatever language the person actually speaks.
const voiceGreetings: Record<string, string> = {
  "en-IN": "Namaste, main Health-Bridge hoon, aapka health companion. Aap jis language mein comfortable hon, usmein baat kar sakte hain. Aaj aapko kis baat ki chinta hai?",
  "hi-IN": "नमस्ते, मैं हेल्थ-ब्रिज हूँ, आपका हेल्थ कंपैनियन। आप जिस भाषा में सहज हों, उसमें बात कर सकते हैं। आज आपको किस बात की चिंता है?",
  "bn-IN": "নমস্কার, আমি হেলথ-ব্রিজ, আপনার স্বাস্থ্যসঙ্গী। আপনি যে ভাষায় স্বচ্ছন্দ, সেই ভাষায় কথা বলতে পারেন। আজ কী নিয়ে চিন্তা হচ্ছে?",
  "mr-IN": "नमस्कार, मी हेल्थ-ब्रिज, तुमचा आरोग्य साथी. तुम्हाला ज्या भाषेत सहज वाटेल त्या भाषेत बोला. आज कशाची काळजी वाटते?",
  "te-IN": "నమస్కారం, నేను హెల్త్-బ్రిడ్జ్, మీ ఆరోగ్య సహచరుడిని. మీకు సౌకర్యంగా ఉన్న భాషలో మాట్లాడండి. ఈరోజు మీకు ఏ విషయం గురించి ఆందోళనగా ఉంది?",
  "ta-IN": "வணக்கம், நான் ஹெல்த்-பிரிட்ஜ், உங்கள் ஆரோக்கியத் துணை. உங்களுக்கு வசதியான மொழியில் பேசலாம். இன்று என்ன கவலை?",
  "gu-IN": "નમસ્તે, હું હેલ્થ-બ્રિજ, તમારો આરોગ્ય સાથી. તમને અનુકૂળ હોય તેવી ભાષામાં વાત કરો. આજે તમને શેની ચિંતા છે?",
  "kn-IN": "ನಮಸ್ಕಾರ, ನಾನು ಹೆಲ್ತ್-ಬ್ರಿಡ್ಜ್, ನಿಮ್ಮ ಆರೋಗ್ಯ ಸಂಗಾತಿ. ನಿಮಗೆ ಅನುಕೂಲವಾದ ಭಾಷೆಯಲ್ಲಿ ಮಾತನಾಡಬಹುದು. ಇಂದು ನಿಮಗೆ ಏನು ಚಿಂತೆ?",
  "ml-IN": "നമസ്കാരം, ഞാൻ ഹെൽത്ത്-ബ്രിഡ്ജ്, നിങ്ങളുടെ ആരോഗ്യസുഹൃത്ത്. നിങ്ങൾക്ക് സൗകര്യമുള്ള ഭാഷയിൽ സംസാരിക്കാം. ഇന്ന് എന്താണ് ആശങ്ക?",
  "pa-IN": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ ਹੈਲਥ-ਬ੍ਰਿਜ, ਤੁਹਾਡਾ ਸਿਹਤ ਸਾਥੀ ਹਾਂ। ਤੁਸੀਂ ਆਪਣੀ ਸੁਖਾਲੀ ਭਾਸ਼ਾ ਵਿੱਚ ਗੱਲ ਕਰ ਸਕਦੇ ਹੋ। ਅੱਜ ਤੁਹਾਨੂੰ ਕਿਸ ਗੱਲ ਦੀ ਚਿੰਤਾ ਹੈ?",
  "or-IN": "ନମସ୍କାର, ମୁଁ ହେଲଥ-ବ୍ରିଜ, ଆପଣଙ୍କ ସ୍ୱାସ୍ଥ୍ୟ ସାଥୀ। ଆପଣ ସୁବିଧା ଅନୁଭବ କରୁଥିବା ଭାଷାରେ କଥା ହୋଇପାରିବେ। ଆଜି କଣ ଚିନ୍ତା ହେଉଛି?",
  "as-IN": "নমস্কাৰ, মই হেল্থ-ব্ৰিজ, আপোনাৰ স্বাস্থ্যৰ সংগী। আপুনি যিটো ভাষাত স্বচ্ছন্দ, সেই ভাষাত কথা পাতিব পাৰে। আজি আপোনাৰ কি চিন্তা হৈছে?",
  "ur-IN": "السلام علیکم، میں ہیلتھ بریج، آپ کا صحت کا ساتھی ہوں۔ آپ جس زبان میں آرام محسوس کریں، اسی میں بات کر سکتے ہیں۔ آج آپ کو کس بات کی فکر ہے؟",
};

export function ConversationWorkspace({ currentId, currentStatus, currentTitle, initialMessages, threads, voiceEnabled, preferredLanguage, triage, soap, doctorSuggestions, appointment }: Props) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(currentId);
  const [status, setStatus] = useState(currentStatus);
  const [title, setTitle] = useState(currentTitle);
  const [fallbackTitle, setFallbackTitle] = useState<string | null>(null);
  const [threadTitles, setThreadTitles] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(currentTitle ?? "");
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [voiceState, setVoiceState] = useState<"idle" | "starting" | "active">("idle");
  const [muted, setMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [assistantLevel, setAssistantLevel] = useState(0);
  const [liveCaption, setLiveCaption] = useState("");
  const vapiRef = useRef<Vapi | null>(null);
  const voiceConversationIdRef = useRef<string | null>(null);
  const reportJobsRef = useRef(new Map<string, Promise<void>>());
  const voiceEndingRef = useRef(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const pendingVoiceFinalRef = useRef<{ id: string; content: string; at: number } | null>(null);
  const voiceInputStreamRef = useRef<MediaStream | null>(null);
  const micLevelMeterRef = useRef<{ context: AudioContext; interval: number } | null>(null);

  function stopMicLevelMeter() {
    if (!micLevelMeterRef.current) return;
    window.clearInterval(micLevelMeterRef.current.interval);
    void micLevelMeterRef.current.context.close().catch(() => {});
    micLevelMeterRef.current = null;
  }

  async function startMicLevelMeter(stream: MediaStream) {
    stopMicLevelMeter();
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    context.createMediaStreamSource(stream).connect(analyser);
    analyser.connect(silentOutput);
    silentOutput.connect(context.destination);
    await context.resume().catch(() => {});
    const samples = new Uint8Array(analyser.fftSize);
    let smoothedLevel = 0;
    const interval = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
      const level = Math.max(0, Math.min(1, (rms - 0.012) * 7));
      smoothedLevel = smoothedLevel * 0.45 + level * 0.55;
      setMicLevel(smoothedLevel);
    }, 50);
    micLevelMeterRef.current = { context, interval };
  }

  function releaseVoiceInput() {
    stopMicLevelMeter();
    voiceInputStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceInputStreamRef.current = null;
    setMicLevel(0);
  }

  // Keep this client workspace mounted across route refreshes so Vapi event
  // listeners and their live transcript state survive the URL update after start.
  useEffect(() => {
    if (voiceConversationIdRef.current && voiceConversationIdRef.current !== currentId) void stopVoice();
    setConversationId(currentId);
    setStatus(currentStatus);
    setTitle(currentTitle);
    setFallbackTitle(null);
    setTitleDraft(currentTitle ?? "");
    setMessages(initialMessages);
  }, [currentId, currentStatus, currentTitle, initialMessages]);

  useEffect(() => {
    if (currentStatus) setStatus(currentStatus);
  }, [currentStatus]);

  useEffect(() => {
    if (!currentTitle) return;
    setTitle(currentTitle);
    setTitleDraft(currentTitle);
    if (currentId) setThreadTitles((previous) => ({ ...previous, [currentId]: currentTitle }));
  }, [currentId, currentTitle]);

  // Resume where the patient left off: on opening a saved thread, land on the
  // newest turn instead of the top of the history.
  useEffect(() => {
    if (!initialMessages.length) return;
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, initialMessages.length, liveCaption]);

  // Voice turns are committed by the server as Vapi calls the custom model.
  // Reconcile those durable rows into this open view so the transcript does not
  // depend on a navigation or a page refresh to appear.
  useEffect(() => {
    if (!conversationId || status !== "active") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refreshMessages = async () => {
      try {
        const response = await fetch(`/api/patient/conversations/${conversationId}/messages`, { cache: "no-store" });
        if (!response.ok) throw new Error("Conversation refresh failed.");
        const payload = await response.json() as { messages?: ThreadMessage[]; status?: "active" | "halted" | "closed" };
        if (cancelled || !Array.isArray(payload.messages)) return;
        if (payload.status === "closed" || payload.status === "halted") {
          setStatus(payload.status);
          if (payload.status === "closed") {
            window.setTimeout(() => {
              if (voiceConversationIdRef.current === conversationId) void stopVoice();
            }, 5000);
          }
        }
        setMessages((previous) => {
          const saved = payload.messages!;
          const savedIds = new Set(saved.map((message) => message.id));
          const pendingLocal = previous.filter((message) => {
            if (savedIds.has(message.id)) return false;
            const matchingSaved = saved.some((savedMessage) =>
              savedMessage.role === message.role && Math.abs(Date.parse(savedMessage.createdAt) - Date.parse(message.createdAt)) < 45_000 &&
              (savedMessage.content === message.content || (
                message.id.startsWith("vapi-local-patient-") && savedMessage.modality === "voice" &&
                Date.parse(savedMessage.createdAt) >= Date.parse(message.createdAt) - 2_000
              )),
            );
            return !matchingSaved && Date.now() - Date.parse(message.createdAt) < 45_000;
          });
          const pendingVoice = pendingVoiceFinalRef.current;
          if (pendingVoice && saved.some((message) => message.role === "patient" && message.modality === "voice" && message.content === pendingVoice.content)) {
            pendingVoiceFinalRef.current = null;
          }
          const merged = [...saved, ...pendingLocal].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
          const unchanged = previous.length === merged.length && previous.every((message, index) => {
            const next = merged[index];
            return next && message.id === next.id && message.content === next.content && message.contentEnglish === next.contentEnglish;
          });
          return unchanged ? previous : merged;
        });
      } catch {
        // The saved transcript remains available on the next poll; keep the live conversation usable.
      }
      if (!cancelled) timer = setTimeout(refreshMessages, 1200);
    };
    void refreshMessages();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [conversationId, status]);

  async function revokeVoiceSession(targetId = conversationId) {
    if (!targetId) return;
    try {
      await fetch(`/api/patient/conversations/${targetId}/voice-session`, { method: "DELETE" });
    } catch {
      // Session credentials also expire after 15 minutes if a disconnect prevents revocation.
    }
  }

  async function stopVoice() {
    if (voiceEndingRef.current) return;
    voiceEndingRef.current = true;
    const targetConversationId = voiceConversationIdRef.current ?? conversationId;
    const client = vapiRef.current;
    vapiRef.current = null;
    try { await client?.stop(); } catch { /* stopping a disconnected call is already complete */ }
    releaseVoiceInput();
    await revokeVoiceSession(targetConversationId);
    voiceConversationIdRef.current = null;
    setVoiceState("idle");
    setMuted(false);
    setMicLevel(0);
    setAssistantLevel(0);
    setLiveCaption("");
    pendingVoiceFinalRef.current = null;
    voiceEndingRef.current = false;
  }

  const prepareReport = useCallback(async (targetId: string) => {
    const existingJob = reportJobsRef.current.get(targetId);
    if (existingJob) return existingJob;
    const job = (async () => {
      // Create the clinician handoff (including its SOAP note) before the
      // structured patient report, and fail visibly if either step is rejected.
      const triageResponse = await fetch(`/api/patient/conversations/${targetId}/triage`, { method: "POST" });
      const triagePayload = await triageResponse.json().catch(() => ({})) as { error?: string };
      if (!triageResponse.ok) throw new Error(triagePayload.error || "The SOAP note could not be prepared.");
      const response = await fetch(`/api/patient/conversations/${targetId}/report`, { method: "POST" });
      const reportPayload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(reportPayload.error || "The care summary could not be prepared.");
    })().catch((reason: unknown) => {
      reportJobsRef.current.delete(targetId);
      throw reason;
    });
    reportJobsRef.current.set(targetId, job);
    return job;
  }, []);

  const hasPatientMessages = messages.some((message) => message.role === "patient");
  useEffect(() => {
    if (!conversationId || status !== "closed" || !hasPatientMessages) return;
    let cancelled = false;
    void prepareReport(conversationId)
      .then(() => { if (!cancelled) router.refresh(); })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "The care summary could not be prepared.");
      });
    return () => { cancelled = true; };
  }, [conversationId, status, hasPatientMessages, prepareReport, router]);

  async function startVoice(targetConversationId = conversationId) {
    if (!targetConversationId || voiceState !== "idle" || (targetConversationId === conversationId && status !== "active") || pending) return;
    setVoiceState("starting");
    setError("");
    try {
      const sessionResponse = await fetch(`/api/patient/conversations/${targetConversationId}/voice-session`, {
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

      // Explicitly request browser acoustic echo cancellation on the captured
      // microphone track so the assistant's speaker output cannot feed back as
      // fresh caller audio. The Vapi call keeps its normal interruption support.
      const inputStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const inputTrack = inputStream.getAudioTracks()[0];
      if (!inputTrack) {
        inputStream.getTracks().forEach((track) => track.stop());
        throw new Error("Your microphone could not be started. Check your browser microphone settings.");
      }
      voiceInputStreamRef.current = inputStream;
      await startMicLevelMeter(inputStream);

      const { default: VapiClient } = await import("@vapi-ai/web");
      const client = new VapiClient(sessionData.publicKey, undefined, undefined, { audioSource: inputTrack });
      setLiveCaption("");
      pendingVoiceFinalRef.current = null;
      vapiRef.current = client;
      voiceConversationIdRef.current = targetConversationId;
      // Remote assistant audio drives the speaker side of the visualizer.
      // The local mic meter reads a silent Web Audio tap of the AEC track above.
      client.on("volume-level", (level: number) => setAssistantLevel(Math.max(0, Math.min(1, level))));
      client.on("call-start", () => setVoiceState("active"));
      client.on("call-end", () => {
        const requestedStop = voiceEndingRef.current;
        vapiRef.current = null;
        setVoiceState("idle");
        setMuted(false);
        setMicLevel(0);
        setAssistantLevel(0);
        setLiveCaption("");
        pendingVoiceFinalRef.current = null;
        releaseVoiceInput();
        voiceConversationIdRef.current = null;
        void revokeVoiceSession(targetConversationId);
        if (requestedStop) return;
        void fetch(`/api/patient/conversations/${targetConversationId}/messages`, { cache: "no-store" })
          .then(async (response) => response.ok ? await response.json() as { messages?: ThreadMessage[] } : { messages: [] })
          .then((payload) => payload.messages?.some((message) => message.role === "patient")
            ? prepareReport(targetConversationId).catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : "The care summary could not be prepared.");
            })
            : undefined)
          .catch(() => {})
          .finally(() => router.refresh());
      });
      client.on("message", (event: unknown) => {
        if (typeof event !== "object" || event === null || !("type" in event)) return;
        if (event.type === "speech-update" && "role" in event && event.role === "assistant" && "status" in event && event.status === "started") {
          pendingVoiceFinalRef.current = null;
          return;
        }
        if (event.type !== "transcript") return;
        if (!("transcriptType" in event) || (event.transcriptType !== "final" && event.transcriptType !== "partial") || !("transcript" in event) || typeof event.transcript !== "string") return;
        const transcript = event.transcript.trim();
        if (!transcript || !("role" in event) || (event.role !== "user" && event.role !== "assistant")) return;
        if (event.role !== "user") return;
        if (event.transcriptType === "partial") {
          setLiveCaption(transcript);
          return;
        }
        // Show the recognized patient turn immediately. Subsequent final
        // segments within the same utterance update this one bubble; the saved
        // server row replaces it after the model finishes its reply.
        const now = Date.now();
        const pending = pendingVoiceFinalRef.current;
        const sameUtterance = pending && now - pending.at < 3000;
        const id = sameUtterance ? pending.id : `vapi-local-patient-${crypto.randomUUID()}`;
        const content = sameUtterance ? mergeTranscriptParts(pending.content, transcript) : transcript;
        pendingVoiceFinalRef.current = { id, content, at: now };
        setLiveCaption("");
        setMessages((previous) => {
          const message: ThreadMessage = {
            id,
            role: "patient",
            modality: "voice",
            content,
            contentEnglish: null,
            languageCode: null,
            createdAt: new Date(now).toISOString(),
          };
          const existingIndex = previous.findIndex((item) => item.id === id);
          return existingIndex === -1
            ? [...previous, message]
            : previous.map((item, index) => index === existingIndex ? message : item);
        });
      });
      client.on("error", () => {
        setLiveCaption("");
        setError("Voice mode stopped. You can continue by typing or try starting voice again.");
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
        // Automatic multilingual detection lets callers switch languages
        // mid-call. Partial transcripts also drive the live speech indicator.
        transcriber: {
          // Deepgram was the stable path before automatic multi-language mode
          // was added. Keep multilingual auto-detection while making Gladia a
          // provider fallback so a silent primary STT session cannot swallow speech.
          provider: "deepgram",
          model: "nova-3",
          language: "multi",
          fallbackPlan: {
            transcribers: [{ provider: "gladia", model: "fast", languageBehaviour: "automatic multiple languages", receivePartialTranscripts: true }],
          },
        },
        firstMessage: voiceGreetings[preferredLanguage] ?? voiceGreetings["en-IN"],
        firstMessageMode: "assistant-speaks-first",
        firstMessageInterruptionsEnabled: true,
        stopSpeakingPlan: {
          numWords: 0,
          voiceSeconds: 0.15,
          backoffSeconds: 0.4,
          acknowledgementPhrases: ["I understand", "I see", "I hear you", "right", "okay", "ok", "yeah", "yes", "uh-huh", "mm-hmm", "got it", "sure"],
          interruptionPhrases: ["stop", "wait", "hold on", "let me speak", "pause", "bas karo", "ruko", "ek minute"],
        },
        // Keep interruption support while using the voice configured in Vapi.
        artifactPlan: { recordingEnabled: false, loggingEnabled: false, transcriptPlan: { enabled: false } },
      });
      if (!call) throw new Error("Voice mode could not connect. You can continue by typing.");
      setVoiceState("active");
    } catch (reason) {
      vapiRef.current = null;
      releaseVoiceInput();
      await revokeVoiceSession(targetConversationId);
      voiceConversationIdRef.current = null;
      setVoiceState("idle");
      setError(reason instanceof Error ? reason.message : "Voice mode could not start. You can continue by typing.");
    }
  }

  async function startConversation() {
    if (starting) return;
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
      router.replace(`/patient/conversations?id=${payload.conversation.id}`);
      if (voiceEnabled) await startVoice(payload.conversation.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start this conversation.");
    } finally {
      setStarting(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!conversationId || !content || pending || status !== "active") return;
    if (!navigator.onLine) {
      setError("You appear to be offline. This message was not sent.");
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
        status?: "active" | "closed";
        error?: string;
      };
      if (!response.ok) {
        setMessages((previous) => previous.filter((message) => message.id !== clientMessageId));
        throw new Error(payload.error || "Your message could not be processed.");
      }

      const savedMessages = [payload.patientMessage, payload.assistantMessage].filter((message): message is ThreadMessage => Boolean(message));
      setMessages((previous) => [...previous.filter((message) => message.id !== clientMessageId), ...savedMessages]);
      setStatus(payload.status ?? "active");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your message could not be processed.");
    } finally {
      setPending(false);
    }
  }

  async function createNewThread() {
    if (vapiRef.current) await stopVoice();
    if (conversationId && !messages.some((message) => message.role === "patient")) {
      await fetch(`/api/patient/conversations/${conversationId}/close`, { method: "DELETE" }).catch(() => {});
    }
    setConversationId(null);
    setStatus(null);
      setMessages([]);
    setError("");
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
      setThreadTitles((previous) => ({ ...previous, [conversationId]: payload.conversation?.title ?? next }));
      setRenaming(false);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This title could not be saved.");
    }
  }

  async function finishConversation() {
    if (!conversationId || status !== "active" || pending || starting) return;
    setPending(true);
    setError("");
    try {
      const expectedPatientTurns = messages.filter((message) => message.role === "patient").length;
      let latestMessages = messages;
      if (vapiRef.current) {
        await stopVoice();
        // Vapi may still be completing its last transcript request when the
        // patient presses Finish. Wait for those turns to reach durable storage
        // before creating the SOAP handoff and care summary.
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const savedResponse = await fetch(`/api/patient/conversations/${conversationId}/messages`, { cache: "no-store" });
          if (savedResponse.ok) {
            const savedPayload = await savedResponse.json() as { messages?: ThreadMessage[] };
            if (Array.isArray(savedPayload.messages)) {
              latestMessages = savedPayload.messages;
              setMessages(savedPayload.messages);
              const savedPatientTurns = savedPayload.messages.filter((message) => message.role === "patient").length;
              if (savedPatientTurns >= expectedPatientTurns && (expectedPatientTurns > 0 || attempt >= 2)) break;
            }
          }
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
        if (latestMessages.filter((message) => message.role === "patient").length < expectedPatientTurns) {
          throw new Error("The last voice message is still being saved. Please try finishing again in a moment.");
        }
      }
      if (!latestMessages.some((message) => message.role === "patient")) {
        const discardResponse = await fetch(`/api/patient/conversations/${conversationId}/close`, { method: "DELETE" });
        if (discardResponse.status === 204) {
          setConversationId(null);
          setStatus(null);
          setMessages([]);
          router.replace("/patient/conversations?new=1");
          return;
        }
        if (discardResponse.status !== 409) throw new Error("The empty conversation could not be removed.");
      }
      // Keep the thread usable if report generation fails. Close only after
      // both the SOAP handoff and patient summary have been saved.
      await prepareReport(conversationId);
      const response = await fetch(`/api/patient/conversations/${conversationId}/close`, { method: "POST" });
      const payload = await response.json() as { conversation?: { status: "active" | "closed" | "halted" }; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not finish this conversation.");
      setStatus(payload.conversation?.status ?? "closed");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not finish this conversation.");
    } finally {
      router.refresh();
      setPending(false);
    }
  }

  async function continueConversation() {
    if (!conversationId || (status !== "closed" && status !== "halted") || pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/patient/conversations/${conversationId}/reopen`, { method: "POST" });
      const payload = await response.json() as { conversation?: { status: "active" }; error?: string };
      if (!response.ok) throw new Error(payload.error || "This conversation could not be reopened.");
      reportJobsRef.current.delete(conversationId);
      setStatus(payload.conversation?.status ?? "active");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This conversation could not be reopened.");
    } finally {
      setPending(false);
    }
  }

  // Titles are generated after the message response, so poll the lightweight
  // owned-title endpoint and update both the header and history in place.
  const hasMessages = messages.length > 0;
  useEffect(() => {
    if (!conversationId || !hasMessages || title) return;
    const timer = setTimeout(() => {
      setFallbackTitle("Health check-in");
      setThreadTitles((previous) => previous[conversationId] ? previous : { ...previous, [conversationId]: "Health check-in" });
      void fetch(`/api/patient/conversations/${conversationId}/title`, { method: "POST" })
        .then(async (response) => response.ok ? await response.json() as { conversation?: { title: string | null } } : null)
        .then((payload) => {
          const nextTitle = payload?.conversation?.title?.trim();
          if (nextTitle && nextTitle !== "Health check-in") {
            setTitle(nextTitle);
            setFallbackTitle(null);
            setTitleDraft(nextTitle);
            setThreadTitles((previous) => ({ ...previous, [conversationId]: nextTitle }));
          }
        }).catch(() => {});
    }, 12_000);
    return () => clearTimeout(timer);
  }, [conversationId, hasMessages, title]);
  useEffect(() => {
    if (!conversationId || title || !hasMessages) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/api/patient/conversations/${conversationId}/title`, { cache: "no-store" });
        const payload = await response.json() as { conversation?: { title: string | null } };
        const nextTitle = payload.conversation?.title?.trim();
        if (!cancelled && nextTitle && nextTitle !== "Health check-in") {
          setTitle(nextTitle);
          setFallbackTitle(null);
          setTitleDraft(nextTitle);
          setThreadTitles((previous) => ({ ...previous, [conversationId]: nextTitle }));
          return;
        }
      } catch { /* title availability must not affect the intake */ }
      if (!cancelled && attempts++ < 40) timer = setTimeout(poll, 750);
    };
    timer = setTimeout(poll, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [conversationId, title, hasMessages]);

  const voiceActivity = Math.max(micLevel, assistantLevel);

  return (
    <main className="relative isolate grid w-full gap-4 overflow-y-auto bg-[radial-gradient(circle_at_16%_8%,rgba(73,185,157,0.11),transparent_22rem),radial-gradient(circle_at_86%_24%,rgba(91,155,213,0.10),transparent_25rem),radial-gradient(circle_at_62%_92%,rgba(233,168,111,0.08),transparent_21rem)] p-3 sm:p-4 lg:h-[calc(100dvh-4rem)] lg:min-h-0 lg:grid-cols-[280px_minmax(0,1fr)] lg:overflow-hidden lg:p-5">
      <aside className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        <div className="sticky top-0 z-20 rounded-2xl bg-background/90 py-1 backdrop-blur-md">
          <Button className="min-h-11 w-full" disabled={pending || starting} onClick={createNewThread}>New conversation</Button>
        </div>
        <section className="rounded-2xl border bg-card p-4" aria-label="Conversation history">
          <h2 className="text-sm font-semibold">Recent conversations</h2>
          {threads.length ? <ul className="mt-3 space-y-1">{threads.map((thread) => {
            const active = thread.id === conversationId;
            return <li key={thread.id}><Link href={`/patient/conversations?id=${thread.id}`} onClick={async (event) => {
              if (active) return;
              event.preventDefault();
              if (conversationId && !messages.some((message) => message.role === "patient")) {
                if (vapiRef.current) await stopVoice();
                await fetch(`/api/patient/conversations/${conversationId}/close`, { method: "DELETE" }).catch(() => {});
              }
              router.push(`/patient/conversations?id=${thread.id}`);
            }} className={`block rounded-xl px-3 py-2.5 text-sm ${active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}>
              {threadTitles[thread.id] || thread.title || (active && !hasMessages)
                ? <span className="block line-clamp-2">{threadTitles[thread.id] || thread.title || "New conversation"}</span>
                : <span className="hb-title-shimmer my-1 block" aria-label="Naming this conversation" />}
              <span className="mt-1 block text-xs">
                {new Date(thread.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                {" · "}
                {new Date(thread.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </span>
            </Link></li>;
          })}</ul> : <p className="mt-2 text-sm text-muted-foreground">Your saved conversations will appear here.</p>}
        </section>
        <p className="px-1 text-xs leading-relaxed text-muted-foreground">Health-Bridge offers intake support, not a diagnosis or a substitute for a doctor.</p>
      </aside>

      <section className="flex min-h-[70vh] flex-col overflow-hidden rounded-3xl border bg-card shadow-sm lg:min-h-0">
        <header className="shrink-0 border-b px-5 py-4 sm:px-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              {renaming && conversationId ? <form onSubmit={saveTitle} className="mt-1 flex flex-wrap items-center gap-2">
                <label htmlFor="conversation-title" className="sr-only">Conversation title</label>
                <input id="conversation-title" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} maxLength={60} autoFocus className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-lg font-semibold" />
                <Button type="submit" size="sm" disabled={titleDraft.trim().length < 2}>Save</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setRenaming(false); setTitleDraft(title ?? ""); }}>Cancel</Button>
              </form> : <div className="mt-1 flex flex-wrap items-center gap-3">
                <h1 className="flex items-center gap-2 text-xl font-semibold">
                  {title || fallbackTitle
                    ? title || fallbackTitle
                    : conversationId
                        ? hasMessages
                          ? <span className="hb-title-shimmer" aria-label="Naming this conversation" />
                          : "New conversation"
                        : "New conversation"}
                </h1>
                {conversationId && <Button type="button" size="icon-sm" variant="ghost" aria-label="Rename conversation" title="Rename conversation" onClick={() => { setTitleDraft(title ?? ""); setRenaming(true); }}><svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m16 4 4 4M4 20l4-.8L19.2 8a2.8 2.8 0 0 0-4-4L4.8 15.2 4 20Z" /></svg></Button>}
              </div>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {conversationId && status === "active" && <Button type="button" size="sm" variant="outline" disabled={pending || starting} onClick={() => void finishConversation()}>Finish conversation</Button>}
            </div>
          </div>
        </header>

        {!conversationId ? (
          <div className="m-auto w-full max-w-3xl p-5 sm:p-8">
            <div className="rounded-3xl border bg-card/95 p-5 shadow-lg shadow-emerald-950/5 backdrop-blur-sm sm:p-7">
              <p className="text-sm font-semibold text-primary">Before you begin</p>
              <h2 className="mt-2 text-xl font-semibold">A private, continuous intake thread</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Your messages are saved to your account and sent to OpenAI to detect language, translate, and prepare a brief response. The assistant does not diagnose or prescribe.</p>
              <p className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm leading-6 text-muted-foreground">By starting, you agree that your messages will be processed by OpenAI and saved in this account for this conversation. {voiceEnabled ? "Your microphone will start after you press Start; your browser may ask for microphone access." : "You can share your concern by typing."}</p>
              {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
              <Button className="mt-5 min-h-12 w-full shadow-md shadow-emerald-900/10" disabled={starting} onClick={startConversation}>{starting ? "Starting…" : voiceEnabled ? "Start conversation with microphone" : "Start conversation"}</Button>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="conversation" className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="border-b px-4 sm:px-6">
              <TabsList variant="line">
                <TabsTrigger value="conversation">Conversation</TabsTrigger>
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="soap">SOAP</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="conversation" className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-7" aria-live="polite" aria-relevant="additions text">
                {(status === "closed" || status === "halted") && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"><p>Intake is complete. Your SOAP note and summary are being prepared automatically.</p><Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void continueConversation()}>Continue conversation</Button></div>}
                {!messages.length && <div className="mx-auto mt-12 max-w-2xl rounded-2xl bg-muted/40 p-5 text-center"><p className="font-medium">Namaste, main Health-Bridge hoon, aapka health companion. Aapko kis baat ki chinta hai?</p></div>}
                {messages.map((message) => <article key={message.id} className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[76%] ${message.role === "patient" ? "ml-auto rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-background"}`}>
                  <p className="mb-1 flex flex-wrap items-center gap-x-2 text-[11px] font-semibold opacity-70">
                    <span>{message.role === "patient" ? "You" : "Health-Bridge · AI intake"}{message.modality === "voice" ? " · voice" : ""}{message.languageCode ? ` · ${message.languageCode}` : ""}</span>
                    <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time>
                  </p>
                  <p>{message.content}</p>
                  {message.contentEnglish && message.contentEnglish !== message.content && <details className="mt-2 border-t border-current/20 pt-2 text-xs"><summary className="cursor-pointer">English translation</summary><p className="mt-1">{message.contentEnglish}</p></details>}
                </article>)}
                {liveCaption && voiceState === "active" && <article className="ml-auto max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary/75 px-4 py-3 text-sm leading-relaxed text-primary-foreground sm:max-w-[76%]" aria-live="polite">
                  <p className="mb-1 text-[11px] font-semibold opacity-70">You · voice · live</p>
                  <p>{liveCaption}</p>
                </article>}
                {pending && <p className="text-sm text-muted-foreground" role="status">Preparing a response…</p>}
                {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
                {conversationId && <AppointmentProposal
                  key={`triage-${conversationId}`}
                  initialTriage={triage}
                  initialSuggestions={doctorSuggestions}
                  initialAppointment={appointment}
                />}
                {/* Anchor used to resume at the newest turn when a saved thread opens. */}
                <div ref={threadEndRef} aria-hidden="true" />
              </div>
              <form onSubmit={sendMessage} className="shrink-0 border-t bg-card/95 p-3 backdrop-blur-sm sm:p-4">
                <label htmlFor="conversation-message" className="sr-only">Write your health message</label>
                <div className="flex items-end gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Textarea id="conversation-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1800} rows={2} placeholder="Type in Hindi, English, or a mix…" disabled={pending || status !== "active"} className="max-h-40 min-h-12 w-full pb-7 pr-16" />
                    <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] tabular-nums text-muted-foreground">{draft.length}/1800</span>
                  </div>
                  {voiceEnabled && <Button type="button" variant={voiceState === "active" ? "destructive" : "outline"} className="min-h-11" disabled={pending || status !== "active" || voiceState === "starting"} onClick={() => voiceState === "active" ? void stopVoice() : void startVoice()} aria-label={voiceState === "active" ? "End voice conversation" : "Start voice conversation"} title={voiceState === "active" ? "End voice conversation" : "Start microphone"}>{voiceState === "starting" ? "Starting…" : voiceState === "active" ? "End voice" : <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/></svg>}</Button>}
                  <Button type="submit" className="min-h-11" disabled={pending || !draft.trim() || status !== "active"}>Send</Button>
                </div>
                {voiceEnabled && voiceState === "active" && <div className="mt-3 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2" role="status" aria-live="polite">
                  <span className={`hb-voice-bars shrink-0 ${voiceActivity > 0.06 ? "is-speaking" : ""}`} aria-hidden="true">
                    {[0.58, 0.9, 0.68, 1, 0.52].map((gain, index) => (
                      <span key={index} style={{ transform: `scaleY(${Math.max(0.12, Math.min(1, voiceActivity * gain))})` }} />
                    ))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-primary">{muted ? "Microphone muted" : assistantLevel > 0.12 ? "Health-Bridge is speaking" : micLevel > 0.12 ? "I can hear you" : "Listening for your voice"}</p>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => { const nextMuted = !muted; vapiRef.current?.setMuted(nextMuted); setMuted(nextMuted); if (nextMuted) setMicLevel(0); }}>{muted ? "Unmute" : "Mute"}</Button>
                </div>}
              </form>
            </TabsContent>

            <TabsContent value="summary" className="flex min-h-0 flex-1 flex-col">
              <CareSummaryPanel key={`${conversationId}:${triage?.id ?? "none"}`} conversationId={conversationId} triageSummary={triage?.summary ?? null} conversationFinished={status === "closed" || status === "halted"} />
            </TabsContent>
            <TabsContent value="soap" className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6">
              <SoapNotePreview soap={soap} />
            </TabsContent>
          </Tabs>
        )}
      </section>
    </main>
  );
}
