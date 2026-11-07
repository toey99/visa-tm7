import DayBoard from "@/components/DayBoard";

// /today — งานวันนี้: 30-day extension board (server namespace "days/").
export default function TodayPage() {
  return <DayBoard mode="ext" />;
}
