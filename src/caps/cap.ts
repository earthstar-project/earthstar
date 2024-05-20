import { ANY_SUBSPACE, OPEN_END } from "@earthstar/willow-utils";
import { Auth } from "../auth/auth.ts";
import {
  decodeIdentityTag,
  encodeIdentityTag,
  IdentityTag,
} from "../identifiers/identity.ts";
import { encodeShareTag, ShareTag } from "../identifiers/share.ts";
import { Path } from "../path/path.ts";
import { meadowcapParams } from "../schemes/schemes.ts";
import { isErr, ValidationError } from "../util/errors.ts";
import { ReadCapPack, WriteCapPack } from "./types.ts";
import { encodeCapPack, isReadCapPack } from "./util.ts";
import { Meadowcap } from "@earthstar/meadowcap";

const meadowcap = new Meadowcap(meadowcapParams);

/** An unforgeable token bestowing read or write access to a share.
 */
export class Cap {
  private capPack: ReadCapPack | WriteCapPack;
  private auth: Auth;

  /** The tag of the share which this capability grants access to. */
  readonly share: ShareTag;
  /** The tag of the receiver of the capability. */
  readonly receiver: IdentityTag;
  /** Whether this capablity grants read or write access. */
  readonly accessMode: "read" | "write";
  /** The identity this capability is restricted to, if any. */
  readonly grantedIdentity: IdentityTag | undefined;
  /** The path prefix this capability is restricted to. */
  readonly grantedPathPrefix: Path;
  /** The time range this capability is restricted to. */
  readonly grantedTime: {
    start: bigint;
    /** The end of the time range, if any. */
    end: bigint | undefined;
  };
  /** The number of times this capability has been delegated. */
  readonly delegatedTimes: number;

  /** Generally you shouldn't need to construct a {@linkcode Cap} yourself. */
  constructor(capPack: ReadCapPack | WriteCapPack, auth: Auth) {
    this.capPack = capPack;
    this.auth = auth;

    const cap = isReadCapPack(capPack) ? capPack.readCap : capPack.writeCap;

    this.share = encodeShareTag(cap.namespaceKey);
    this.receiver = encodeIdentityTag(
      meadowcap.getCapReceiver(cap),
    );
    this.accessMode = cap.accessMode;

    const grantedArea = meadowcap.getCapGrantedArea(cap);

    this.grantedIdentity = grantedArea.includedSubspaceId === ANY_SUBSPACE
      ? undefined
      : encodeIdentityTag(grantedArea.includedSubspaceId);
    this.grantedPathPrefix = new Path(grantedArea.pathPrefix);
    this.grantedTime = {
      start: grantedArea.timeRange.start,
      end: grantedArea.timeRange.end === OPEN_END
        ? undefined
        : grantedArea.timeRange.end,
    };

    this.delegatedTimes = cap.delegations.length;
  }

  /** Determine if the capability is valid or not. */
  isValid(): Promise<boolean> {
    return this.auth.isValidCapPack(this.capPack);
  }

  /** Delegate the capability to someone else.
   *
   * A capability can only be delegated if the corresponding {@linkcode IdentityKeypair} for this capability's receiver is known.
   *
   * @param toUser The tag of the identity to delegate the capability to.
   * @param restrictTo Optional restrictions to apply to the delegated capability. If these grant a more powerful capability than the capability being delegated from an error will be returned.
   * @returns The delagated {@linkcode Cap}, or an error if the keypair for the keypair's receiver is not known OR the delegated capability is more powerful than the capability it was delegated from OR any of the given identity tags were not valid.
   */
  async delegate(toIdentity: IdentityTag, restrictTo?: {
    /** The tag of the identity to restrict access to. */
    identity?: IdentityTag;
    /** The path prefix to restrict access to. */
    pathPrefix?: Path;
    /** The time range to restrict access to. */
    time?: {
      start: bigint;
      end: bigint;
    };
  }): Promise<Cap | ValidationError> {
    const toUserDecoded = decodeIdentityTag(toIdentity);

    if (isErr(toUserDecoded)) {
      return toUserDecoded;
    }

    const restrictToIdentity = restrictTo?.identity
      ? decodeIdentityTag(restrictTo.identity)
      : undefined;

    if (isErr(restrictToIdentity)) {
      return restrictToIdentity;
    }

    const result = await this.auth.delegateCapPack({
      capPack: this.capPack as ReadCapPack,
      toUser: toUserDecoded,
      restrictTo: {
        ...restrictTo,
        identity: restrictToIdentity,
      },
    });

    if (isErr(result)) {
      return result;
    }

    return new Cap(result, this.auth);
  }

  /** Export the capability to an encoded format for transmission. */
  export(): Uint8Array {
    return encodeCapPack(this.capPack);
  }
}
