import DayBoard from "@/components/DayBoard";

// /visarun — visa-run board: same intake and summary, plus car seating
// cards; TM.7 only for customers doing "run + 30-day extension".
// Server namespace "run/" — kept apart from the extension board's days.
export default function VisaRunPage() {
  return <DayBoard mode="run" />;
}
