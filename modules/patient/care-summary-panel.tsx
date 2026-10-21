"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  conversationId: string;
};

type PanelState =
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string };

/**
 * Shows the same PDF that "Download summary" produces, but rendered in the page
 * so it can be read without saving a file. The document is generated and stored
 * server-side, so the preview and the download are byte-for-byte the same.
 *
 * Give this component a `key` that includes the conversation id (and any value
 * that should force a reload) so a new thread starts from a clean preview.
 */
export function CareSummaryPanel({ conversationId }: Props) {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const urlRef = useRef<string | null>(null);

  const release = useCallback(() => {
    if (urlRef.current) {
      window.URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(
          `/api/patient/conversations/${conversationId}/report`,
          { method: "POST" },
        );
        if (cancelled) return;
        if (!response.ok) {
          const payload = (await response
            .json()
            .catch(() => ({}))) as { error?: string };
          const message = payload.error || "This summary is not ready yet.";
          setState(
            response.status === 404 || response.status === 409
              ? { kind: "empty", message }
              : { kind: "error", message },
          );
          return;
        }
        const blob = await response.blob();
        if (cancelled) return;
        const url = window.URL.createObjectURL(blob);
        urlRef.current = url;
        setState({ kind: "ready", url });
      } catch {
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              "The summary could not be loaded. Check your connection and try again.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, attempt]);

  useEffect(() => release, [release]);

  function retry() {
    release();
    setState({ kind: "loading" });
    setAttempt((value) => value + 1);
  }

  if (state.kind === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground" role="status">
          Preparing your summary…
        </p>
      </div>
    );
  }

  if (state.kind === "empty" || state.kind === "error") {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl border bg-muted/30 p-5 text-sm">
          <p className="font-semibold">
            {state.kind === "empty"
              ? "No summary yet"
              : "The summary could not be shown"}
          </p>
          <p className="mt-2 leading-6 text-muted-foreground">{state.message}</p>
          {state.kind === "empty" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Prepare a care summary in the Conversation tab first. It appears
              here once it exists.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={retry}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Exactly the PDF you would download — same layout, same wording.
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            const anchor = document.createElement("a");
            anchor.href = state.url;
            anchor.download = "health-bridge-care-summary.pdf";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
          }}
        >
          Download PDF
        </Button>
      </div>
      <iframe
        src={state.url}
        title="Care summary PDF"
        className="h-full min-h-[50vh] w-full flex-1 rounded-xl border bg-white"
      />
    </div>
  );
}
