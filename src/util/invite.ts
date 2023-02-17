import { parseShareAddress } from "../core-validators/addresses.ts";
import { Crypto } from "../crypto/crypto.ts";
import { ShareAddress } from "./doc-types.ts";
import { isErr, ValidationError } from "./errors.ts";

/** Creates an invitation URL. Validates the share address, that servers are valid URLs, and the secret against the share address if given. */
export async function createInvitationURL(
  shareAddress: ShareAddress,
  servers: string[],
  secret?: string,
): Promise<string | ValidationError> {
  const parsedShareAddress = parseShareAddress(shareAddress);

  if (isErr(parsedShareAddress)) {
    return new ValidationError(`Invalid share address.`);
  }

  for (const server of servers) {
    try {
      new URL(server);
    } catch {
      return new ValidationError(`Could not parse ${server} as a URL.`);
    }
  }

  const serverParams = servers.map((url) => `&server=${url}`).join("&");

  let secretParam = "";

  if (secret) {
    const isValid = await Crypto.checkKeypairIsValid({
      shareAddress,
      secret,
    });

    if (isErr(isValid)) {
      return new ValidationError(
        `Supplied the wrong secret for ${shareAddress}`,
      );
    }

    secretParam = `&secret=${secret}`;
  }

  const invitationURL =
    `earthstar://${shareAddress}/?invite${serverParams}${secretParam}&v=2`;

  return invitationURL;
}

type ParsedInvitation = {
  shareAddress: ShareAddress;
  secret?: string;
  servers: string[];
};

/** Parses an invitation URL. Validates the share address, secret (if given), and any server URLs. */
export async function parseInvitationURL(
  invitationURL: string,
): Promise<ParsedInvitation | ValidationError> {
  try {
    const url = new URL(invitationURL);

    const isValidShareAddress = parseShareAddress(url.hostname);

    if (isErr(isValidShareAddress)) {
      return new ValidationError(
        "Invitation did not include a valid share address.",
      );
    }

    const params = new URLSearchParams(url.search);

    const isInvitation = params.get("invite");
    const version = params.get("v");

    if (isInvitation === null) {
      return new ValidationError("Not an invitation URL");
    }

    if (version === null) {
      return new ValidationError("Invitation version not specified.");
    }

    if (version !== "2") {
      return new ValidationError(
        `Invitation version is ${version}, expected version 2.`,
      );
    }

    const servers = params.getAll("server");

    for (const server of servers) {
      try {
        new URL(server);
      } catch {
        return new ValidationError(
          `Invitation's servers included a malformed URL: ${server}`,
        );
      }
    }

    const secret = params.get("secret");

    if (secret) {
      const isValid = await Crypto.checkKeypairIsValid({
        shareAddress: url.hostname,
        secret: secret,
      });

      if (isErr(isValid)) {
        return new ValidationError(
          `Invitation contains the wrong secret for share ${url.hostname}.`,
        );
      }
    }

    return {
      shareAddress: url.hostname,
      secret: secret || undefined,
      servers: servers,
    };
  } catch {
    return new ValidationError("Could not parse the invitation URL.");
  }
}
