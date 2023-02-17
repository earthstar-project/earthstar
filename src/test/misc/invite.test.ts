import { Crypto } from "../../crypto/crypto.ts";
import { isErr, notErr } from "../../util/errors.ts";
import { createInvitationURL, parseInvitationURL } from "../../util/invite.ts";
import { assert, assertEquals } from "../asserts.ts";

Deno.test("encodeInvitationURL", async () => {
  const shareKeypair = await Crypto.generateShareKeypair("test");

  assert(notErr(shareKeypair));

  // Catches bad share addresses
  const badShareRes = await createInvitationURL(
    "+BAD.addr",
    [],
  );

  assert(isErr(badShareRes));

  // Catches bad URLs
  const badUrlRes = await createInvitationURL(
    shareKeypair.shareAddress,
    ["https://server.com", "NOT_A_URL"],
  );

  assert(isErr(badUrlRes));

  // Catches bad secrets
  const badSecretRes = await createInvitationURL(
    shareKeypair.shareAddress,
    ["https://server.com"],
    "NOT_THE_SECRET",
  );

  assert(isErr(badSecretRes));

  // Puts out a good code too.
  const goodRes = await createInvitationURL(
    shareKeypair.shareAddress,
    ["https://server.com", "https://server2.com"],
    shareKeypair.secret,
  );

  assert(notErr(goodRes));
});

Deno.test("parseInvitationURL", async () => {
  const shareKeypair = await Crypto.generateShareKeypair("test");

  assert(notErr(shareKeypair));

  // Catches non-URLs
  const notURL = "Hello there.";
  const notUrlRes = await parseInvitationURL(notURL);
  assert(isErr(notUrlRes));

  // Catches bad share address
  const badAddress = "earthstar://notashare/?invite";
  const badAddressRes = await parseInvitationURL(badAddress);
  assert(isErr(badAddressRes));

  // Catches non-invite
  const notInvite = `earthstar://${shareKeypair.shareAddress}/some/path`;
  const notInviteRes = await parseInvitationURL(notInvite);
  assert(isErr(notInviteRes));

  // Catches missing version
  const missingVersion = `earthstar://${shareKeypair.shareAddress}/?invite`;
  const missingVersionRes = await parseInvitationURL(missingVersion);
  assert(isErr(missingVersionRes));

  // Catches wrong version
  const wrongVersion = `earthstar://${shareKeypair.shareAddress}/?invite&v=1`;
  const wrongVersionRes = await parseInvitationURL(wrongVersion);
  assert(isErr(wrongVersionRes));

  // Catches bad URLs
  const badServerUrl =
    `earthstar://${shareKeypair.shareAddress}/?invite&server=NOT_URL&v=2`;
  const badServerUrlRes = await parseInvitationURL(badServerUrl);
  assert(isErr(badServerUrlRes));

  // Catches bad secret
  const badSecret =
    `earthstar://${shareKeypair.shareAddress}/?invite&server=https://server.com&secret=NOT_REAL_SECRET&v=2`;
  const badSecretRes = await parseInvitationURL(badSecret);
  assert(isErr(badSecretRes));

  const goodUrl =
    `earthstar://${shareKeypair.shareAddress}/?invite&server=https://server.com&server=https://server2.com&secret=${shareKeypair.secret}&v=2`;
  const goodResult = await parseInvitationURL(goodUrl);
  assert(notErr(goodResult));

  assertEquals(goodResult.shareAddress, shareKeypair.shareAddress);
  assertEquals(goodResult.servers, [
    "https://server.com",
    "https://server2.com",
  ]);
  assertEquals(goodResult.secret, shareKeypair.secret);
});
