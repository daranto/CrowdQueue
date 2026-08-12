import assert from "node:assert/strict";
import test from "node:test";
import { QR_CARD_COUNTS, cardGrid, qrExportFileBase } from "../client/src/qrExportOptions";

test("Kartenanzahlen ergeben vollständig gefüllte A4-Raster", () => {
  for (const count of QR_CARD_COUNTS) {
    const grid = cardGrid(count);
    assert.equal(grid.columns * grid.rows, count);
  }
  assert.deepEqual(cardGrid(2), { columns: 1, rows: 2 });
  assert.deepEqual(cardGrid(6), { columns: 2, rows: 3 });
  assert.deepEqual(cardGrid(12), { columns: 3, rows: 4 });
});

test("Exportdateien erhalten sichere, lesbare Namen", () => {
  assert.equal(qrExportFileBase("Robins große Ö-Party!"), "crowdqueue-robins-grosse-o-party");
  assert.equal(qrExportFileBase("🎉"), "crowdqueue-party");
});
