// Live smoke test, no key: one postcode lookup against the real API.
import { ClearPostcode } from "./index.js";

const { data, meta } = await new ClearPostcode().lookup("SW1A 1AA");
console.log(data.postcode, data.status, "|", data.local_authority?.name, "|", data.constituency?.name, "| edition", meta.edition);
if (data.postcode !== "SW1A 1AA" || data.status !== "live") process.exit(1);
