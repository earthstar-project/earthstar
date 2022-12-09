import { Peer } from "../../peer/peer.ts";
import { Replica } from "../../replica/replica.ts";
import { isErr } from "../../util/errors.ts";
import { IServerExtension } from "./extension.ts";
import { contentType } from "https://deno.land/std@0.167.0/media_types/mod.ts";
import { extname } from "https://deno.land/std@0.154.0/path/mod.ts";

/**
 * - `sourceShare`: The share to use as the source of documents. Must have been created by another extension.
 * - `path`: An optional path prefix for requests. E.g. `/stuff` means a call to `/stuff/blog.md` would fetch `/blog.md` from the replica.
 * - `indexPath`: A fallback path to use when none is provided. Useful for landing pages.
 * - `allowOrigins`: A list of origins allowed by CORS, if you want other sites to be able to request content from your replica server.
 */
export interface ExtensionServeContentOpts {
  sourceShare: string;
  path?: string;
  indexPath?: string;
  allowedOrigins?: string[];
}

/** An extension for exposing the contents of shares, so that you can request documents by their path and have them served over HTTP. Can be used to create wikis, websites, image galleries, and more. */
export class ExtensionServeContent implements IServerExtension {
  private peer: Peer | null = null;
  private path = "/";
  private replica: Replica | null = null;
  private sourceShare: string;
  private indexPath: string | undefined;
  private allowedOrigins: string[] = [];

  constructor(opts: ExtensionServeContentOpts) {
    if (opts.path) {
      this.path = opts.path;
    }

    this.sourceShare = opts.sourceShare;
    this.indexPath = opts.indexPath;

    if (opts.allowedOrigins) {
      this.allowedOrigins = opts.allowedOrigins;
    }
  }

  register(peer: Peer) {
    this.peer = peer;

    const replica = this.peer.getReplica(this.sourceShare);

    if (!replica) {
      throw new Error(
        `No replica belonging to share ${this.sourceShare} was found!`,
      );
    }

    this.replica = replica;

    return Promise.resolve();
  }

  async handler(
    req: Request,
  ): Promise<Response | null> {
    const pathPattern = new URLPattern({
      pathname: `${this.path}*`,
    });

    const pathPatternResult = pathPattern.exec(req.url);

    if (this.replica && pathPatternResult && req.method === "GET") {
      const pathToGet = pathPatternResult.pathname.groups[0];

      if (pathToGet === "" && this.indexPath) {
        const doc = await this.replica.getLatestDocAtPath(this.indexPath);

        if (doc) {
          const attachment = await this.replica.getAttachment(doc);

          if (attachment && !isErr(attachment)) {
            return new Response(
              await attachment.stream(),
              {
                headers: {
                  status: "200",
                  "content-type": getContentType(doc.path),
                  "access-control-allow-origin": `localhost ${
                    this.allowedOrigins.join(", ")
                  }`,
                },
              },
            );
          }

          return new Response(
            doc.text,
            {
              headers: {
                status: "200",
                "content-type": getContentType(doc.path),
                "access-control-allow-origin": `localhost ${
                  this.allowedOrigins.join(", ")
                }`,
              },
            },
          );
        }
      }

      const maybeDocument = await this.replica.getLatestDocAtPath(
        `/${pathToGet}`,
      );

      if (!maybeDocument) {
        return new Response("Not found", {
          headers: {
            status: "404",
          },
        });
      }

      const attachment = await this.replica.getAttachment(maybeDocument);

      if (attachment && !isErr(attachment)) {
        return new Response(
          await attachment.stream(),
          {
            headers: {
              status: "200",
              "content-type": getContentType(maybeDocument.path),
              "access-control-allow-origin": `localhost ${
                this.allowedOrigins.join(", ")
              }`,
            },
          },
        );
      }

      if (attachment === undefined) {
        return new Response(
          `Not found: ${maybeDocument.text}, ${maybeDocument.attachmentSize}`,
          {
            headers: {
              status: "404",
              "content-type": getContentType(maybeDocument.path),
              "access-control-allow-origin": `localhost ${
                this.allowedOrigins.join(", ")
              }`,
            },
          },
        );
      }

      return new Response(
        maybeDocument.text,
        {
          headers: {
            status: "200",
            "content-type": getContentType(maybeDocument.path),
            "access-control-allow-origin": `localhost ${
              this.allowedOrigins.join(", ")
            }`,
          },
        },
      );
    }

    return Promise.resolve(null);
  }
}

function getContentType(path: string): string {
  const extension = extname(path);

  return contentType(extension) || "text/plain";
}
