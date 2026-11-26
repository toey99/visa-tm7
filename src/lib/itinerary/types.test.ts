import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyTrip, mergeDoc, normFlightNo, normTime, sortedFlights, tripWarnings, type ScanDoc } from "./types.ts";

const noPassport = { surname: "", given: "", cnName: "" };
const leg = (o: Partial<ScanDoc["legs"][number]>): ScanDoc["legs"][number] => ({
  airline: "", flightNo: "", date: "25/11/2026", from: "CEI", to: "DMK", fromTerminal: "", toTerminal: "",
  depTime: "", arrTime: "", boardTime: "", gate: "", passengers: [], ...o,
});

test("normTime handles 12h and 24h forms", () => {
  assert.equal(normTime("8:35 AM"), "08:35");
  assert.equal(normTime("08:40 pm"), "20:40");
  assert.equal(normTime("12:05 am"), "00:05");
  assert.equal(normTime("19:40, 25 NOV"), "19:40");
  assert.equal(normTime("-"), "");
});

test("normFlightNo adds the airline code to a bare number", () => {
  assert.equal(normFlightNo("109", "Nok Air"), "DD109");
  assert.equal(normFlightNo("SL 545"), "SL545");
  assert.equal(normFlightNo("Nokair DD102"), "DD102");
  assert.equal(normFlightNo("fd 3210", "AirAsia"), "FD3210");
});

test("booking + passport + boarding pass merge into one rider", () => {
  let trip = emptyTrip();
  trip = mergeDoc(trip, { kind: "ticket", passport: noPassport, legs: [
    leg({ airline: "Nokair", flightNo: "DD102", date: "01/12/2026", from: "DMK", to: "CEI", fromTerminal: "T2", depTime: "8:35 AM", arrTime: "10:00 AM",
      passengers: [{ surname: "MA", given: "JIANGTAO", pnr: "VQPJ9R", seat: "", hasBoardingPass: false }, { surname: "MA", given: "ZHIBIN", pnr: "VQPJ9R", seat: "", hasBoardingPass: false }] }),
    leg({ airline: "Nokair", flightNo: "DD109", date: "01/12/2026", depTime: "7:15 PM", arrTime: "8:35 PM",
      passengers: [{ surname: "MA", given: "JIANGTAO", pnr: "3J1FQV", seat: "", hasBoardingPass: false }] }),
  ] });
  trip = mergeDoc(trip, { kind: "passport", passport: { surname: "MA", given: "JIANGTAO", cnName: "马江涛" }, legs: [] });
  trip = mergeDoc(trip, { kind: "ticket", passport: noPassport, legs: [
    leg({ airline: "Nok Air", flightNo: "109", date: "01/12/2026", boardTime: "06:45 pm", depTime: "07:15 pm",
      passengers: [{ surname: "MA", given: "JIANGTAO", pnr: "3J1FQV", seat: "22H", hasBoardingPass: true }] }),
  ] });
  assert.equal(trip.people.length, 2);
  assert.equal(trip.people[0].cn, "马江涛");
  assert.equal(trip.flights.length, 2);
  const [out, back] = sortedFlights(trip);
  assert.equal(out.flightNo, "DD102");
  assert.equal(out.depTime, "08:35");
  assert.equal(back.riders.length, 1);
  assert.deepEqual(back.riders[0], { id: "MA JIANGTAO", pnr: "3J1FQV", seat: "22H", hasBoardingPass: true });
  assert.equal(back.boardTime, "18:45");
  assert.equal(tripWarnings(trip).needCheckIn, true); // outbound still has no boarding pass
});

test("same flight number with two departure times stays two cards and is flagged", () => {
  let trip = emptyTrip();
  trip = mergeDoc(trip, { kind: "ticket", passport: noPassport, legs: [leg({ flightNo: "DD109", depTime: "19:15", passengers: [{ surname: "JIAO", given: "ZHIYONG", pnr: "7QB8X3", seat: "", hasBoardingPass: false }] })] });
  trip = mergeDoc(trip, { kind: "ticket", passport: noPassport, legs: [leg({ airline: "Nok Air", flightNo: "109", depTime: "08:40 pm", passengers: [{ surname: "SONG", given: "YUHANG", pnr: "LN42UZ", seat: "22H", hasBoardingPass: true }] })] });
  assert.equal(trip.flights.length, 2);
  assert.equal(tripWarnings(trip).timeConflict.size, 2);
});

test("a boarding pass with no departure time joins the booked flight", () => {
  let trip = emptyTrip();
  trip = mergeDoc(trip, { kind: "ticket", passport: noPassport, legs: [leg({ flightNo: "FD3210", depTime: "19:40", passengers: [{ surname: "TAN", given: "JIE", pnr: "OLTVQR", seat: "", hasBoardingPass: false }] })] });
  trip = mergeDoc(trip, { kind: "ticket", passport: noPassport, legs: [leg({ flightNo: "FD 3210", boardTime: "19:00", gate: "4", passengers: [{ surname: "TAN", given: "JIE", pnr: "OLTVQR", seat: "6E", hasBoardingPass: true }] })] });
  assert.equal(trip.flights.length, 1);
  assert.equal(trip.flights[0].gate, "4");
  assert.equal(trip.flights[0].riders[0].hasBoardingPass, true);
});

test("leaving from DMK and landing back at BKK is flagged per person", () => {
  let trip = emptyTrip();
  trip = mergeDoc(trip, { kind: "ticket", passport: noPassport, legs: [
    leg({ flightNo: "DD102", date: "27/11/2026", from: "DMK", to: "CEI", depTime: "08:35", passengers: [{ surname: "WANG", given: "YANG", pnr: "0GTB5Z", seat: "", hasBoardingPass: false }] }),
    leg({ flightNo: "VZ135", date: "27/11/2026", from: "CEI", to: "BKK", depTime: "20:00", passengers: [{ surname: "WANG", given: "YANG", pnr: "DR4JKV", seat: "", hasBoardingPass: false }] }),
  ] });
  assert.deepEqual(tripWarnings(trip).airportSwap, ["WANG YANG"]);
});
