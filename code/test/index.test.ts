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
  feeds[0].calendar.getFirstSubcomponent("vevent")?.updatePropertyWithValue("summary", "Custom Day");
  const merged = ICAL.Component.fromString(await mergeCalendars(feeds, "Holidays"));
  const events = merged.getAllSubcomponents("vevent");
  const summaries = events.map((event) => String(event.getFirstPropertyValue("summary")));

  assert.equal(events.length, expected);
  assert.equal(new Set(events.map((event) => event.getFirstPropertyValue("uid"))).size, events.length);
  assert(summaries.every((summary) => /^(Andalucía|Japan): /.test(summary)));
  assert(summaries.includes("Andalucía: Custom Day"));
  assert.equal(merged.getFirstPropertyValue("x-wr-calname"), "Holidays");
  assert.equal(merged.getFirstPropertyValue("x-wr-caldesc"), null);
});
