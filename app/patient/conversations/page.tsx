import { PatientEmptyState } from "@/modules/patient/empty-state";

export default function PatientConversationsPage() {
  return <PatientEmptyState eyebrow="Your conversations" title="Your AI conversations will be kept together here" description="The patient conversation and voice intake feature is planned for a later phase. When available, you will be able to review your conversations and their summaries here." actionLabel="Back to dashboard" actionHref="/patient/dashboard" />;
}
