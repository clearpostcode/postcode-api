// Browser tests only: the API as the finder sees it, with CORS, on http://127.0.0.1:8766/v1. Canned answers.
import { createServer } from "node:http";

const AREAS = { "SW1A 1AA": "Westminster", "M1 1AE": "Manchester", "EH1 1YZ": "City of Edinburgh" };
const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "x-request-id": "fake" });
  res.end(JSON.stringify(body));
};
createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const meta = { edition: "2026-08" };
  if (u.pathname === "/v1/autocomplete") return send(res, 200, { data: Object.keys(AREAS).filter((p) => p.startsWith((u.searchParams.get("q") ?? "").toUpperCase())).map((postcode) => ({ type: "postcode", postcode })), meta });
  if (u.pathname.startsWith("/v1/addresses")) return send(res, 401, { type: "https://clearpostcode.co.uk/developers/docs/errors#key_required", title: "Key required", status: 401, detail: "d", instance: u.pathname, request_id: "fake" });
  const pc = decodeURIComponent(u.pathname.replace("/v1/postcodes/", "")).toUpperCase();
  if (AREAS[pc]) return send(res, 200, { data: { postcode: pc, status: "live", replaced_by: null, local_authority: { code: "x", name: AREAS[pc] }, ward: { code: "x", name: "Test Ward" }, constituency: { code: "x", name: "Test Constituency" }, region: { code: "x", name: "Test Region" }, country: { code: "x", name: "England" } }, meta });
  return send(res, 404, { type: "https://clearpostcode.co.uk/developers/docs/errors#postcode_not_found", title: "Not found", status: 404, detail: "d", instance: u.pathname, request_id: "fake" });
}).listen(8766, "127.0.0.1");
