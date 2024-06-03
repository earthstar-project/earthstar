import { assertEquals } from "@std/assert";
import { Path } from "./path.ts";

Deno.test("Path.format('ascii')", () => {
  const path = Path.fromStrings("hello", "world.yaml")

  assertEquals(path.format('ascii'), 'hello/world.yaml')
});
