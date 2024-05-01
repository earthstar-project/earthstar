import { assert, assertEquals } from "../asserts.ts";
import { generateShareAddress } from "../../util/misc.ts";
import { isErr } from "../../util/errors.ts";
import { checkShareIsValid } from "../../core-validators/addresses.ts";

Deno.test("generateShareAddress", () => {
  const address = generateShareAddress("testing");
  assert(!isErr(address), "address is valid (according to itself)");
  assert(checkShareIsValid(address as string), "address is valid");
  assert(
    (address as string).startsWith("+testing."),
    "address contains the given name",
  );

  const suffix = (address as string).split(".")[1];
  assertEquals(suffix.length, 12, "suffix is 12 chars long");
});
