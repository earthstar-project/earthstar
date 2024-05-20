import type { Peer } from "../../peer/peer.ts";

/** Implement this interface to create an Earthstar server extension.
 */
export interface ServerExtension {
  /** Called once by the {@linkcode Server}, and this is where you can get a reference to its underlying @{linkcode Peer}. */
  register(peer: Peer): Promise<void>;
  /** Called by the server when it is trying to fulfil an external {@linkcode Request}. If your extension does not interact with user requests you can return `Promise<null>`. */
  handler(req: Request): Promise<Response | null>;
}
