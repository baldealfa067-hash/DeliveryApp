const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve((request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  return new Response(JSON.stringify({ error: "O cadastro passou para o painel de administração" }), {
    status: 410,
    headers,
  });
});
