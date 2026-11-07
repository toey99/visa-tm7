// =============================================================
// Visa-run fleet
// =============================================================
// The four cars that drive customers to the border. Each car gets its own
// seating card (one PNG per car) so the customers know which car to look
// for at the airport. Photos live in public/cars/.

export type Car = {
  id: string;        // stored on the person ("1".."4")
  name: string;      // make/model shown on the card
  plate: string;     // licence plate as printed
  province: string;  // plate province
  color: string;     // colour word for the card (TH / ZH)
  colorZh: string;
  image: string;     // public path
  seats: number;     // max passengers
  accent: string;    // card accent colour
};

export const CARS: Car[] = [
  { id: "1", name: "MG ZS", plate: "ขง 4967", province: "เชียงราย", color: "สีขาว", colorZh: "白色", image: "/cars/mg.jpg", seats: 4, accent: "#2563eb" },
  { id: "2", name: "Nissan March", plate: "กร 2322", province: "เชียงราย", color: "สีขาว", colorZh: "白色", image: "/cars/march.jpg", seats: 4, accent: "#16a34a" },
  { id: "3", name: "Toyota Vios", plate: "กล 1858", province: "เชียงราย", color: "สีเงิน", colorZh: "银色", image: "/cars/vios.jpg", seats: 4, accent: "#7c3aed" },
  { id: "4", name: "Toyota Camry", plate: "ขท 7397", province: "เชียงราย", color: "สีดำ", colorZh: "黑色", image: "/cars/camry.jpg", seats: 4, accent: "#dc2626" },
];

export function carById(id: string | undefined): Car | undefined {
  return CARS.find((c) => c.id === id);
}

// Time-of-day slot shown on the card ("05 พ.ย. เช้า" / "11月05号早上").
export const RUN_SLOTS: { id: string; th: string; zh: string }[] = [
  { id: "morning", th: "เช้า", zh: "早上" },
  { id: "noon", th: "เที่ยง", zh: "中午" },
  { id: "afternoon", th: "บ่าย", zh: "下午" },
  { id: "evening", th: "เย็น", zh: "傍晚" },
];

// Meeting point after landing (Chiang Rai airport, gate 2) — drawn at the
// bottom of every car card so the customer gets one picture, not two.
export const MEETING_POINT = {
  gate: "2",
  insideImage: "/cars/gate-inside.jpg",
  outsideImage: "/cars/gate-outside.jpg",
};
