import { Peer } from "../../peer/peer.ts";

/** Implement this interface to create an Earthstar server extension.
 *
 * - `register` is called once by the server, and this is where you can get a reference to its underlying `Earthstar.Peer`.
 * - `handler` is called by the server when it is trying to fulfil an external request. If your extension does not interact with user requests you can return `Promise.resolve(null)`.
 */
export interface IServerExtension {
  register(peer: Peer): Promise<void>;
  handler(req: Request): Promise<Response | null>;
}
