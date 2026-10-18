import { PatientEmptyState } from "@/modules/patient/empty-state";

export default function PatientAppointmentsPage() {
  return <PatientEmptyState eyebrow="Your care" title="Your appointments will appear here" description="No appointments are booked. Doctor profiles are available to browse, while scheduling and booking are being built. Nothing is booked without your confirmation." actionLabel="Find a doctor" actionHref="/patient/doctors" />;
}
