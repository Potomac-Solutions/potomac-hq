import assert from "node:assert/strict";
import { test } from "node:test";
import { thing } from "./thing.ts";
test("ok", () => assert.equal(thing, 1));
