Deno.serve(async (request) => {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  return new Response(JSON.stringify({ error: "This endpoint is retired. Use the admin-users function." }), { status: 410, headers });
});
