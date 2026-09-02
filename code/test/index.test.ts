import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ICAL from "ical.js";
import worker, { mergeCalendars } from "../index.ts";

const load = () =>
  [
    ["madrid", "spain/madrid"],
    ["berlin", "germany/berlin"],
  ].map(([name, path]) => ({
    url: `https://www.officeholidays.com/ics/${path}`,
    calendar: ICAL.Component.fromString(
      readFileSync(new URL(`fixtures/${name}.ics`, import.meta.url), "utf8"),
    ),
  }));

test("merges real calendars", async () => {
  const feeds = load();
  const expected = feeds.reduce((n, feed) => n + feed.calendar.getAllSubcomponents("vevent").length, 0);
  feeds[0].calendar.getFirstSubcomponent("vevent")?.updatePropertyWithValue("summary", "Custom Day");
  const merged = ICAL.Component.fromString(await mergeCalendars(feeds, "Holidays"));
  const events = merged.getAllSubcomponents("vevent");
  const summaries = events.map((event) => String(event.getFirstPropertyValue("summary")));

  assert.equal(events.length, expected);
  assert.equal(new Set(events.map((event) => event.getFirstPropertyValue("uid"))).size, events.length);
  assert(summaries.every((summary) => /^Holidays: (Madrid|Berlin): /.test(summary)));
  assert(summaries.includes("Holidays: Madrid: Custom Day"));
  assert.equal(merged.getFirstPropertyValue("x-wr-calname"), "Holidays");
  assert.equal(merged.getFirstPropertyValue("x-wr-caldesc"), null);
});

test("sets description from description", async () => {
  const merged = ICAL.Component.fromString(await mergeCalendars(load(), "Holidays", "Work and travel"));
  assert.equal(merged.getFirstPropertyValue("x-wr-caldesc"), "Work and travel");
});

test("title flags", async () => {
  const withName = load();
  withName[0].calendar.getFirstSubcomponent("vevent")?.updatePropertyWithValue("summary", "Custom Day");
  const named = ICAL.Component.fromString(await mergeCalendars(withName, "Holidays", null, true, true));
  assert(
    named
      .getAllSubcomponents("vevent")
      .map((event) => String(event.getFirstPropertyValue("summary")))
      .includes("Holidays: Madrid: Custom Day"),
  );

  const plain = load();
  plain[0].calendar.getFirstSubcomponent("vevent")?.updatePropertyWithValue("summary", "Custom Day");
  const stripped = ICAL.Component.fromString(await mergeCalendars(plain, "Holidays", null, false, false));
  assert(
    stripped
      .getAllSubcomponents("vevent")
      .map((event) => String(event.getFirstPropertyValue("summary")))
      .includes("Custom Day"),
  );
});

const ics = (calendarName?: string) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    calendarName ? `X-WR-CALNAME:${calendarName}` : "",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Madrid",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    "UID:same",
    "SUMMARY:Day",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Ping",
    "TRIGGER:-PT1H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

const feed = (url: string, calendarName?: string) => ({
  url,
  calendar: ICAL.Component.fromString(ics(calendarName)),
});

test("HTTP query params reach the merge", async () => {
  const previous = { fetch: globalThis.fetch, caches: globalThis.caches };
  globalThis.fetch = async () => new Response(ics("Alpha"));
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

  try {
    const response = await worker.fetch(
      new Request(
        "https://unical.test/merge?u=https://a.test/a.ics&name=Work&description=Desk&show_name=true&show_calendar=true",
      ),
      {},
      { waitUntil() {} },
    );
    const calendar = ICAL.Component.fromString(await response.text());

    assert.equal(response.status, 200);
    assert.equal(calendar.getFirstPropertyValue("x-wr-calname"), "Work");
    assert.equal(calendar.getFirstPropertyValue("x-wr-caldesc"), "Desk");
    assert.equal(calendar.getFirstSubcomponent("vevent")?.getFirstPropertyValue("summary"), "Work: Alpha: Day");
  } finally {
    globalThis.fetch = previous.fetch;
    globalThis.caches = previous.caches;
  }
});

test("distinct UIDs for the same original UID", async () => {
  const merged = ICAL.Component.fromString(
    await mergeCalendars(
      [feed("https://a.test/a.ics", "A"), feed("https://b.test/b.ics", "B")],
      "Holidays",
      null,
      false,
      false,
    ),
  );
  const uids = merged.getAllSubcomponents("vevent").map((event) => event.getFirstPropertyValue("uid"));

  assert.equal(uids.length, 2);
  assert.notEqual(uids[0], uids[1]);
});

test("uses URL when X-WR-CALNAME is missing", async () => {
  const url = "https://source.test/cal.ics";
  const merged = ICAL.Component.fromString(await mergeCalendars([feed(url)], "Holidays", null, false, true));

  assert.equal(merged.getFirstSubcomponent("vevent")?.getFirstPropertyValue("summary"), `${url}: Day`);
});

test("keeps VALARM and VTIMEZONE", async () => {
  const merged = ICAL.Component.fromString(
    await mergeCalendars([feed("https://a.test/a.ics", "A")], "Holidays", null, false, false),
  );
  const event = merged.getFirstSubcomponent("vevent");

  assert.equal(merged.getAllSubcomponents("vtimezone").length, 1);
  assert.equal(event?.getFirstSubcomponent("valarm")?.getFirstPropertyValue("description"), "Ping");
});
