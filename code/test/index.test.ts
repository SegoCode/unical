import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ICAL from "ical.js";
import { mergeCalendars } from "../index.ts";

const feeds = ["andalucia", "japan"].map((name) => ({
  url: `https://www.officeholidays.com/ics/${name === "andalucia" ? "spain/" : ""}${name}`,
  calendar: ICAL.Component.fromString(
    readFileSync(new URL(`fixtures/${name}.ics`, import.meta.url), "utf8"),
  ),
}));

test("merges real calendars", async () => {
  const expected = feeds.reduce((n, feed) => n + feed.calendar.getAllSubcomponents("vevent").length, 0);
  const merged = ICAL.Component.fromString(await mergeCalendars(feeds, "Holidays"));
  const events = merged.getAllSubcomponents("vevent");

  assert.equal(events.length, expected);
  assert.equal(new Set(events.map((event) => event.getFirstPropertyValue("uid"))).size, events.length);
  assert(events.every((event) => /^(Andalucía|Japan) Holidays: /.test(String(event.getFirstPropertyValue("summary")))));
  assert.equal(merged.getFirstPropertyValue("x-wr-calname"), "Holidays");
});
