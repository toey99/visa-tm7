// =============================================================
// Flight itinerary for visa-run customers — data model + merging
// =============================================================
// Tickets (Trip.com itineraries, airline boarding passes, as PDF or photo)
// and passport pages are read one file at a time by the scanTicket server
// action. Each read gives a ScanDoc; mergeDoc folds it into the Trip that the
// /itinerary page edits and exports as a picture (中文 / ไทย / English).
//
// Pure functions only — no React, no browser APIs — so node --test can run
// them (types.test.ts).

export type ScanPassenger = {
  surname: string;          // UPPERCASE
  given: string;            // UPPERCASE
  pnr: string;              // airline booking reference / record locator
  seat: string;
  hasBoardingPass: boolean; // true only when the document IS a boarding pass
};

export type ScanLeg = {
  airline: string;          // "Nok Air"
  flightNo: string;         // "DD102"
  date: string;             // DD/MM/YYYY
  from: string;             // IATA, e.g. DMK
  to: string;               // IATA, e.g. CEI
  fromTerminal: string;     // "T2" or ""
  toTerminal: string;
  depTime: string;          // HH:MM 24h, "" when not printed
  arrTime: string;
  boardTime: string;
  gate: string;
  passengers: ScanPassenger[];
};

export type ScanDoc = {
  kind: "ticket" | "passport" | "other";
  passport: { surname: string; given: string; cnName: string };
  legs: ScanLeg[];
};

export type Rider = {
  id: string;               // person key: "SURNAME GIVEN"
  pnr: string;
  seat: string;
  hasBoardingPass: boolean;
};

export type Flight = {
  id: string;
  airline: string;
  flightNo: string;
  date: string;
  from: string;
  to: string;
  fromTerminal: string;
  toTerminal: string;
  depTime: string;
  arrTime: string;
  boardTime: string;
  gate: string;
  riders: Rider[];
};

export type PersonName = { id: string; surname: string; given: string; cn: string };

export type Trip = {
  people: PersonName[];
  flights: Flight[];
  showMeetingPoint: boolean; // "meet at Gate 2" line for arrivals in Chiang Rai
  showBaggage: boolean;      // "cabin bags only, 7 kg" line
};

export const emptyTrip = (): Trip => ({ people: [], flights: [], showMeetingPoint: true, showBaggage: true });

// ---------- normalising ----------

const up = (s: unknown) => (typeof s === "string" ? s : "").trim().toUpperCase().replace(/\s+/g, " ");
export const personKey = (surname: string, given: string) => `${up(surname)} ${up(given)}`.trim();
/** Name matching ignores spaces and hyphens: "YONG GANG" on one ticket is "YONGGANG" on another. */
const looseKey = (id: string) => id.replace(/[\s-]+/g, "");

/** "8:35 AM" / "08:35 pm" / "19.40" → "08:35" / "20:35" / "19:40"; anything unreadable → "". */
export function normTime(raw: string): string {
  const s = (raw || "").trim().toLowerCase();
  const m = s.match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/);
  if (!m) return "";
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** "DD 102" / "dd102" / "Nokair DD102" → "DD102"; a bare "109" with airline Nok Air → "DD109". */
export function normFlightNo(raw: string, airline = ""): string {
  const s = up(raw).replace(/[^A-Z0-9]/g, "");
  const m = s.match(/([A-Z][A-Z0-9]|[0-9][A-Z])(\d{1,4})$/);
  if (m) return `${m[1]}${m[2]}`;
  const digits = s.match(/^\d{1,4}$/);
  if (digits) {
    const code = AIRLINE_CODES[up(airline).replace(/[^A-Z]/g, "")];
    return code ? `${code}${s}` : s;
  }
  return s;
}

const AIRLINE_CODES: Record<string, string> = {
  NOKAIR: "DD", THAIAIRASIA: "FD", AIRASIA: "FD", THAILIONAIR: "SL", LIONAIR: "SL",
  THAIVIETJETAIR: "VZ", THAIVIETJET: "VZ", VIETJET: "VZ", THAIAIRWAYS: "TG", BANGKOKAIRWAYS: "PG",
};
const AIRLINE_NAMES: Record<string, string> = {
  DD: "Nok Air", FD: "AirAsia", SL: "Lion Air", VZ: "Thai Vietjet", TG: "Thai Airways", PG: "Bangkok Airways",
};
export function airlineName(flightNo: string, fallback = ""): string {
  return AIRLINE_NAMES[flightNo.slice(0, 2)] ?? (fallback.trim() || "");
}

/** DD/MM/YYYY → sortable YYYYMMDD ("" when unreadable). */
export function dateKey(ddmmyyyy: string): string {
  const m = (ddmmyyyy || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}${m[2].padStart(2, "0")}${m[1].padStart(2, "0")}` : "";
}

// ---------- merging a scanned document into the trip ----------

function findPerson(trip: Trip, id: string): PersonName | undefined {
  const k = looseKey(id);
  return trip.people.find((p) => looseKey(p.id) === k);
}

function upsertPerson(trip: Trip, surname: string, given: string, cn = ""): PersonName {
  const id = personKey(surname, given);
  let p = findPerson(trip, id);
  if (!p) {
    p = { id, surname: up(surname), given: up(given), cn: "" };
    trip.people.push(p);
  }
  if (cn && !p.cn) p.cn = cn.trim();
  return p;
}

/**
 * Fold one scanned document into the trip (returns a new Trip).
 * - passport → fills the person's Chinese name
 * - ticket   → one Flight per flight number + date + departure time; the same
 *   rider seen twice (booking first, boarding pass later) is updated, and a
 *   boarding pass always wins over a booking.
 */
export function mergeDoc(prev: Trip, doc: ScanDoc): Trip {
  const trip: Trip = JSON.parse(JSON.stringify(prev));
  if (doc.kind === "passport") {
    if (doc.passport.surname || doc.passport.given) upsertPerson(trip, doc.passport.surname, doc.passport.given, doc.passport.cnName);
    return trip;
  }
  for (const leg of doc.legs) {
    const flightNo = normFlightNo(leg.flightNo, leg.airline);
    if (!flightNo) continue;
    const depTime = normTime(leg.depTime);
    const incoming = {
      airline: airlineName(flightNo, leg.airline), flightNo, date: (leg.date || "").trim(),
      from: up(leg.from), to: up(leg.to), fromTerminal: up(leg.fromTerminal), toTerminal: up(leg.toTerminal),
      depTime, arrTime: normTime(leg.arrTime), boardTime: normTime(leg.boardTime), gate: up(leg.gate),
    };
    // Same flight = same number and date, and departure times that do not
    // contradict each other (a boarding pass often prints no departure time).
    let f = trip.flights.find((x) => x.flightNo === flightNo && x.date === incoming.date && (!x.depTime || !depTime || x.depTime === depTime));
    if (!f) {
      f = { id: `${flightNo}-${dateKey(incoming.date)}-${depTime || "x"}-${trip.flights.length}`, ...incoming, riders: [] };
      trip.flights.push(f);
    } else {
      for (const k of ["airline", "from", "to", "fromTerminal", "toTerminal", "depTime", "arrTime", "boardTime", "gate"] as const) {
        if (!f[k] && incoming[k]) f[k] = incoming[k];
      }
    }
    for (const sp of leg.passengers) {
      if (!sp.surname && !sp.given) continue;
      const person = upsertPerson(trip, sp.surname, sp.given);
      const pnr = up(sp.pnr).replace(/\s+/g, "");
      const seat = up(sp.seat).replace(/\s+/g, "");
      const r = f.riders.find((x) => x.id === person.id);
      if (!r) f.riders.push({ id: person.id, pnr, seat, hasBoardingPass: !!sp.hasBoardingPass });
      else {
        if (pnr && (!r.pnr || sp.hasBoardingPass)) r.pnr = pnr;
        if (seat) r.seat = seat;
        if (sp.hasBoardingPass) r.hasBoardingPass = true;
      }
    }
  }
  return trip;
}

// ---------- reading the trip for display ----------

export const sortKey = (f: Flight) => `${dateKey(f.date) || "99999999"}${f.depTime || f.boardTime || "99:99"}`;
export const sortedFlights = (trip: Trip) => [...trip.flights].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

const BANGKOK = new Set(["DMK", "BKK"]);
export const HUB = "CEI"; // visa runs go through Chiang Rai

/** "out" = towards Chiang Rai, "back" = leaving it, "" = anything else. */
export function legKind(f: Flight): "out" | "back" | "" {
  if (f.to === HUB) return "out";
  if (f.from === HUB) return "back";
  return "";
}

export type TripWarnings = {
  /** flight ids that share number + date with another card but a different departure time */
  timeConflict: Set<string>;
  /** people who leave from one Bangkok airport and come back to the other */
  airportSwap: string[];
  /** true when at least one rider still has to check in at the counter */
  needCheckIn: boolean;
};

export function tripWarnings(trip: Trip): TripWarnings {
  const timeConflict = new Set<string>();
  for (const a of trip.flights) for (const b of trip.flights) {
    if (a !== b && a.flightNo === b.flightNo && a.date === b.date && a.depTime && b.depTime && a.depTime !== b.depTime) timeConflict.add(a.id);
  }
  const airportSwap: string[] = [];
  for (const p of trip.people) {
    const mine = trip.flights.filter((f) => f.riders.some((r) => r.id === p.id));
    const used = new Set<string>();
    for (const f of mine) for (const code of [f.from, f.to]) if (BANGKOK.has(code)) used.add(code);
    if (used.size > 1) airportSwap.push(p.id);
  }
  const needCheckIn = trip.flights.some((f) => f.riders.some((r) => !r.hasBoardingPass));
  return { timeConflict, airportSwap, needCheckIn };
}

/** YYYYMMDD of the first flight, for file names ("" when no date is known). */
export function tripDateKey(trip: Trip): string {
  const keys = trip.flights.map((f) => dateKey(f.date)).filter(Boolean).sort();
  return keys[0] ?? "";
}
