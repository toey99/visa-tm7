import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "เช็ค Overstay — คำนวณวันหมดอายุวีซ่า (toyka)",
};

// The calculator is a self-contained static page at /public/tools/overstay.html.
// It is still behind Google sign-in: proxy.ts gates every path except
// api/auth, Next internals and image/font/pdf assets — .html is NOT excluded,
// so the iframe source is only served to an allowed account.
export default function OverstayPage() {
  return (
    <main className="flex flex-1 flex-col">
      <iframe
        src="/tools/overstay.html"
        title="คำนวณวันหมดอายุวีซ่า & ค่าปรับ Overstay"
        className="w-full flex-1 border-0"
        style={{ minHeight: "calc(100vh - 52px)" }}
      />
    </main>
  );
}
