# ตัวใหม่: Vercel Pro + Supabase (branch `next-supabase`)

ตัวเก่า (tm7.toyka.net, branch `main`) ใช้งานต่อไปตามปกติ ตัวใหม่อยู่ใน branch นี้และขึ้นเป็นอีกโปรเจกต์หนึ่ง
ใช้คู่กันจนมั่นใจแล้วจึงสลับ

## ต่างจากตัวเก่าอย่างไร

- ข้อมูลข้อความทั้งหมด (บอร์ด บัญชี สลิป งานวีซ่ายาว ฯลฯ) เก็บเป็นแถวในฐานข้อมูล Postgres ตาราง `docs`
- รูปและ PDF เก็บใน Supabase Storage (bucket `files`) มีตาราง `files` เป็นสารบัญ
- โค้ดส่วนอื่นเหมือนตัวเก่าทุกอย่าง เพราะสลับที่ชั้นเก็บข้อมูลชั้นเดียว (`src/lib/blob.ts` → `src/lib/store-supabase.ts`)
- หน้าบัญชีและ Dashboard อ่านข้อมูลทั้งเดือนด้วยคำสั่งเดียว
- ฟังก์ชันรันที่สิงคโปร์ (`vercel.json` → `regions: ["sin1"]`) ใกล้ทั้งผู้ใช้และฐานข้อมูล

## ขั้นตอนตั้งค่า (ทำครั้งเดียว)

1. **Vercel** อัปเกรดทีมเป็น Pro
2. **Supabase** สมัครแผน Pro → New project → Region: Southeast Asia (Singapore)
3. **Supabase → SQL Editor** วางเนื้อหาไฟล์ `supabase/schema.sql` แล้วกด Run
4. **Vercel → Add New → Project** เลือก repo `toey99/visa-tm7` อีกครั้ง ตั้งชื่อเช่น `tm7-next`
   แล้วตั้ง Production Branch เป็น `next-supabase`
5. **Environment Variables ของโปรเจกต์ใหม่**

   | ชื่อ | ค่า |
   |---|---|
   | `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
   | `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → secret key (หรือ service_role) |
   | `OLD_BLOB_READ_WRITE_TOKEN` | ค่าเดียวกับ `BLOB_READ_WRITE_TOKEN` ของโปรเจกต์เก่า (ใช้อ่านเพื่อก๊อปข้อมูลเท่านั้น) |
   | `NEXT_PUBLIC_SITE_LABEL` | `ตัวใหม่ (ทดสอบ)` — ป้ายเหลืองบนเมนู กันสับสนกับตัวจริง |
   | `PUBLIC_ORIGIN` | ที่อยู่ของตัวใหม่ เช่น `https://new.toyka.net` |
   | `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_ALLOWED_EMAILS` | ก๊อปจากโปรเจกต์เก่า |
   | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `CRON_SECRET` | ก๊อปจากโปรเจกต์เก่า |

   **ห้ามใส่ในช่วงทดสอบ**
   - `BLOB_READ_WRITE_TOKEN` — ถ้าใส่ ตัวใหม่อาจเขียนทับข้อมูลจริงของตัวเก่า
   - `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `TELEGRAM_BOT_TOKEN` — ตัวทดสอบต้องไม่ส่งข้อความเข้ากลุ่มจริง
6. **Google Cloud Console → OAuth client** เพิ่ม Authorized redirect URI ของตัวใหม่:
   `https://<ที่อยู่ตัวใหม่>/api/auth/callback/google`
7. Deploy แล้วเข้า `/admin/import` กด "เริ่มก๊อป" (ก๊อปซ้ำได้ทุกเมื่อ ของที่มีแล้วจะถูกข้าม)

## ช่วงใช้คู่กัน

- งานจริงทำบนตัวเก่า ตัวใหม่ใช้ดูและทดสอบ กด "เริ่มก๊อป" เมื่ออยากให้ข้อมูลตัวใหม่ตามทัน
- สลิปและงาน 90 วันจาก LINE เข้าตัวเก่าเท่านั้น (LINE ส่งได้ที่อยู่เดียว)
- อะไรที่แก้ใน `main` ให้ merge เข้า `next-supabase` ด้วย

## วันสลับ

1. หยุดใช้ตัวเก่า → กด "เริ่มก๊อป" รอบสุดท้ายบนตัวใหม่
2. ใส่ `LINE_*` และ `TELEGRAM_BOT_TOKEN` ในโปรเจกต์ใหม่ เอา `NEXT_PUBLIC_SITE_LABEL` ออก
3. ย้ายโดเมน `tm7.toyka.net` มาที่โปรเจกต์ใหม่ (webhook ของ LINE ชี้ที่โดเมนนี้อยู่แล้ว จึงตามมาเอง)
4. เก็บโปรเจกต์เก่าไว้อย่างน้อย 1 เดือนเผื่อย้อนกลับ

## ยังไม่ได้ทำ

- ยังไม่ได้ทดสอบกับ Supabase จริง (เขียนไว้ก่อนมีโปรเจกต์) — ต้องลองทีละหน้าหลังตั้งค่าเสร็จ
- รูปย่อบนบอร์ด / โหลดไฟล์เต็มเฉพาะตอนใช้
- ย้ายข้อมูลบัญชีเป็นตารางจริง (ตอนนี้เก็บเป็นเอกสาร JSON ต่อวัน เหมือนตัวเก่า)
