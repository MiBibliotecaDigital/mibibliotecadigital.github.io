// Deprecated: signed R2 URLs are no longer issued. Deploy the Cloudflare Worker
// in cloudflare/worker.js and configure js/config.js with its URL.
Deno.serve(async () => new Response(
  JSON.stringify({ error: "This endpoint is retired. Use the authenticated PDF gateway." }),
  { status: 410, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
));
