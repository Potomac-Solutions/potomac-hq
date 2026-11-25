import assert from "node:assert/strict";
import { test } from "node:test";
import { readCsv, readImport } from "./import.ts";

test("CSV: commas, quotes, a quote inside quotes, a line break inside quotes, and blank lines", () => {
  const read = readCsv('a,b,c\r\n"Groves, John","John ""Grover"" Groves","two\nlines"\n\n1,,3');
  assert.ok(read.ok);
  assert.deepEqual(read.value, [
    { fields: ["a", "b", "c"], line: 1 },
    { fields: ["Groves, John", 'John "Grover" Groves', "two\nlines"], line: 2 },
    { fields: ["1", "", "3"], line: 5 },
  ]);
  assert.deepEqual(readCsv('a\n"open'), { ok: false, error: "unclosed-quote:2" });
});

const header = "Client,Contact,Phone,Email,Website,Project,Service,Pricing,Price,Repository,Live,Demo";

test("a row becomes a client, its contact and its project; columns go in any order, with a few other names", () => {
  const read = readImport(`${header}\nNu-Finish Collision LLC,"John ""Grover"" Groves",+13013344727,,,Website,website,fixed,1500,https://github.com/Potomac-Solutions/example-site,,no\nHickory Hollow Bakehouse,,,,,Counter,application,free,,https://github.com/Potomac-Solutions/counter,,yes`);
  assert.ok(read.ok);
  assert.deepEqual(read.value[0], {
    line: 2,
    client: "Nu-Finish Collision LLC",
    website: null,
    demo: false,
    contact: { name: 'John "Grover" Groves', title: null, email: null, phone: "+13013344727" },
    project: { name: "Website", service: "website", pricing: "fixed", price: "1500", source: "other", repository: "https://github.com/Potomac-Solutions/example-site", live: null },
  });
  assert.equal(read.value[1]?.demo, true);
  assert.equal(read.value[1]?.contact, null);
  assert.equal(read.value[1]?.project?.pricing, "free");
  const other = readImport("Business,Name,Repo,Project,Price\nElk Diner,Dana,https://github.com/x/y,Site,free");
  assert.ok(other.ok);
  assert.equal(other.value[0]?.project?.repository, "https://github.com/x/y");
  assert.equal(other.value[0]?.project?.pricing, "free", "free as the price is enough");
  assert.equal(other.value[0]?.project?.service, "website", "website when no service is given");
});

test("anything wrong says which line and what to change", () => {
  const problem = (text: string): string => {
    const read = readImport(text);
    return read.ok ? "" : read.error.startsWith("row:") ? read.error.slice(4).replace(":", ": ") : (read.error.split(":")[0] ?? "");
  };
  assert.equal(problem("Client"), "empty");
  assert.equal(problem("Contact\nDana"), "no-client-column");
  assert.equal(problem("Client,Favourite colour\nA,blue"), "unknown-column");
  assert.equal(problem("Client,Contact\nA,Dana\na,Bo"), "3: a is also on line 2.");
  assert.equal(problem("Client,Phone\nA,304-555-0100"), "2: it has an email, phone or title but no contact name.");
  assert.equal(problem("Client,Repository\nA,https://github.com/x/y"), "2: it has a repository but no project name.");
  assert.equal(problem("Client,Project\nA,Site"), "2: a project needs its pricing: free, fixed, hourly, monthly or yearly.");
  assert.equal(problem("Client,Project,Pricing\nA,Site,fixed"), "2: a fixed project needs its price, like 1500.");
  assert.match(problem("Client,Project,Pricing,Service\nA,Site,free,mural"), /^2: “mural” isn’t a service/);
  assert.equal(problem("Client,Demo\nA,maybe"), "2: demo is yes or no.");
  assert.match(problem("Client,Contact\nA,Dana,Extra"), /more values than the header/);
  assert.equal(problem(`Client\n${Array.from({ length: 201 }, (_, n) => `C${n}`).join("\n")}`), "too-many-rows");
});
