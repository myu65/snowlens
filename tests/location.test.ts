import { it, expect } from "vitest";
import {
  exploreHref,
  parseExploreLocation,
  maxExploreUrlLength,
} from "../lib/explore-location";
import {
  ledgerTableHref,
  parseLedgerTableLocation,
  parseLedgerHubLocation,
} from "../lib/ledger-location";
import { initialQuery } from "../lib/model";
import { mockSources } from "../lib/mock";

const parse = (href: string) =>
  parseExploreLocation(new URL(href, "http://localhost"));
it("round-trips quoted sources, typed filters, composite joins and display definitions", () => {
  const source = '["データ DB","S\"","案件 & 表"]';
  const q = {
    ...initialQuery({ ...mockSources[0], id: source }),
    filters: [
      { field: "AMOUNT", operator: "eq" as const, value: 0 },
      { field: "CHECKED", operator: "eq" as const, value: false },
    ],
    join: {
      rightSource: "right",
      type: "left" as const,
      keys: [
        { sourceField: "A", rightField: "A" },
        { sourceField: "B", rightField: "B" },
      ],
    },
    totals: "subtotals" as const,
  };
  const value = {
    source,
    q,
    fields: [{ id: "AMOUNT", label: "金額", description: "自分の表示名" }],
    dialog: "download" as const,
  };
  expect(parse(exploreHref(value))).toEqual(value);
});
it("rejects owner/role/SQL payloads, unknown screens, duplicated and conflicting targets", () => {
  for (const href of [
    "/?owner=someone",
    "/?role=ACCOUNTADMIN",
    "/?sql=select",
    "/?dialog=admin",
    "/?source=a&source=b",
    "/?dataset=d&saved=s",
    "/?dialog=download",
    "/?source=a&q=" +
      encodeURIComponent(JSON.stringify(initialQuery(mockSources[0]))),
    "/?dialog=personal&rows=[]",
    "/?side=yes",
    "/?catalog=" + encodeURIComponent('{"schema":"S"}'),
  ])
    expect(() => parse(href)).toThrow();
  expect(() => parse("/?source=" + "x".repeat(maxExploreUrlLength))).toThrow();
  expect(() => parse("/?q=%7Bbad")).toThrow();
});
it("opens private definition identifiers without accepting input rows or executing an action", () => {
  expect(parse("/?saved=my-view")).toEqual({ saved: "my-view" });
  expect(parse("/?dialog=personal&personal=my-input")).toEqual({
    dialog: "personal",
    personal: "my-input",
  });
  expect(() => parse("/?dialog=personal-delete")).toThrow();
  expect(() => parse("/?personal=my-input")).toThrow();
  expect(() => parse("/?source=x&dialog=cell")).toThrow();
  expect(() =>
    parse(
      "/?source=x&dialog=cell&cell=" +
        encodeURIComponent('{"row":0,"column":"A","value":"secret"}'),
    ),
  ).toThrow();
});
it("restores ledger row, stable create ID, literal search and bounded page offsets", () => {
  const uuid = "8110b453-21a4-4c9e-832b-22e49dca0001";
  const value = { row: "new", draft: uuid, search: "%_ & 顧客", offset: 50 };
  expect(
    parseLedgerTableLocation(
      new URL(
        ledgerTableHref("/ledgers/sales/" + uuid, value),
        "http://localhost",
      ),
    ),
  ).toEqual(value);
  for (const search of [
    "?row=other",
    "?draft=" + uuid,
    "?row=" + uuid + "&draft=" + uuid,
    "?offset=NaN",
    "?offset=1",
    "?offset=100050",
    "?offset=50&offset=100",
    "?values={}",
    "?storage=standard",
  ])
    expect(() =>
      parseLedgerTableLocation(
        new URL("http://localhost/ledgers/sales/" + uuid + search),
      ),
    ).toThrow();
  expect(
    parseLedgerHubLocation(new URL("http://localhost/ledgers?space=quality")),
  ).toEqual({ space: "quality" });
  expect(
    parseLedgerHubLocation(new URL("http://localhost/ledgers?space=_test")),
  ).toEqual({ space: "_test" });
  expect(
    parseLedgerTableLocation(
      new URL(
        "http://localhost/ledgers/sales/" + uuid + "?row=" + uuid.toUpperCase(),
      ),
    ).row,
  ).toBe(uuid);
  expect(() =>
    parseLedgerHubLocation(
      new URL("http://localhost/ledgers?role=quality_writer"),
    ),
  ).toThrow();
});
