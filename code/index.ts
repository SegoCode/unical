import ICAL from "ical.js";

type Feed = { url: string; calendar: ICAL.Component };

export async function mergeCalendars(feeds: Feed[], name: string) {
  const merged = feeds[0].calendar;

  for (const { url, calendar } of feeds) {
    const calendarName = calendar.getFirstPropertyValue("x-wr-calname") || url;
    const prefix = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");

    for (const component of [...calendar.getAllSubcomponents()]) {
      const uid = component.getFirstProperty("uid");
      if (uid?.getFirstValue()) uid.setValue(`${prefix}-${uid.getFirstValue()}`);
      if (component.name === "vevent")
        component.updatePropertyWithValue("summary", `${calendarName}: ${component.getFirstPropertyValue("summary") || ""}`);
      if (calendar !== merged) merged.addSubcomponent(component);
    }
  }

  merged.updatePropertyWithValue("x-wr-calname", name);
  return merged.toString();
}

export default {
  async fetch(request: Request, _env: unknown, context: ExecutionContext) {
    const url = new URL(request.url);
    const sources = url.searchParams.getAll("u");

    if (request.method !== "GET") return new Response("Not found", { status: 404 });
    if (url.pathname === "/") return new Response("ok");
    if (url.pathname !== "/merge") return new Response("Not found", { status: 404 });
    if (!sources.length || sources.length > 4)
      return new Response("Provide between 1 and 4 u parameters", { status: 400 });

    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;

    const feeds = (
      await Promise.all(
        sources.map(async (source) => {
          try {
            const response = await fetch(source, { signal: AbortSignal.timeout(10_000) });
            if (!response.ok) return null;
            return { url: source, calendar: ICAL.Component.fromString(await response.text()) };
          } catch {
            return null;
          }
        }),
      )
    ).filter((feed): feed is Feed => feed !== null);

    if (!feeds.length) return new Response("All feeds failed", { status: 502 });

    const response = new Response(
      await mergeCalendars(feeds, url.searchParams.get("name") || "Unical"),
      {
        headers: {
          "content-type": "text/calendar; charset=utf-8",
          "cache-control": "public, max-age=900",
        },
      },
    );

    context.waitUntil(cache.put(request, response.clone()));
    return response;
  },
};
