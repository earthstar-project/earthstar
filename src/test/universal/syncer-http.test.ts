import { assert } from "../asserts.ts";
import { serve } from "https://deno.land/std@0.123.0/http/server.ts";
import { SyncerHttpHandler } from "../../syncer/syncer-http-handler.ts";
import { SyncerHttpClient } from "../../syncer/syncer-http-client.ts";

import { Crypto } from "../../crypto/crypto.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { Peer } from "../../peer/peer.ts";
import { makeNStorages, storagesAreSynced } from "../test-utils.ts";
import { sleep } from "../../util/misc.ts";

const keypairA = await Crypto.generateAuthorKeypair("suzy") as AuthorKeypair;
const keypairB = await Crypto.generateAuthorKeypair("devy") as AuthorKeypair;
const keypairC = await Crypto.generateAuthorKeypair("smee") as AuthorKeypair;

// 	On addPeer
//    Did the storages sync?
//  On close
//    Do we leave any hanging async ops?

// TODO: Turn this into one of those vector-laden tests when we have more kinds of syncers

Deno.test({
    name: "SyncerHttpClient + SyncerHttpHandler",
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
        const ADDRESS_A = "+apples.a123";

        const [storageA1, storageA2, storageServer] = makeNStorages(ADDRESS_A, 3);

        // Storage A docs

        await storageA1.set(keypairA, {
            path: "/apples/colours.txt",
            content: "Green, red, yellow",
            format: "es.4",
        });

        await storageA2.set(keypairB, {
            path: "/apples/tastes.txt",
            content: "Sweet, tart, sour",
            format: "es.4",
        });

        await storageServer.set(keypairC, {
            path: "/apples/textures.txt",
            content: "Crisp, juicy, mealy",
            format: "es.4",
        });

        // Set up three peers

        const peer1 = new Peer();
        const peer2 = new Peer();

        peer1.addStorage(storageA1);
        peer2.addStorage(storageA2);

        // start a server.

        const peerServer = new Peer();
        peerServer.addStorage(storageServer);

        const httpHandler = new SyncerHttpHandler(peerServer, "/");

        const controller = new AbortController();
        serve(
            httpHandler.handler,
            { hostname: "0.0.0.0", port: 1234, signal: controller.signal },
        );

        // Add a peer, verify syncedness

        const httpClient1 = new SyncerHttpClient(peer1);

        await httpClient1.addServer(`http://localhost:1234`);
        await sleep(100);

        assert(
            await storagesAreSynced([storageA1, storageServer]),
            "Http Client 1 and Server are synced",
        );

        // check manually for doc

        // add another peer and verify syncedness

        const httpClient2 = new SyncerHttpClient(peer2);

        await httpClient2.addServer("http://localhost:1234");
        await sleep(100);

        assert(
            await storagesAreSynced([storageA2, storageServer]),
            "Http Client 2 and Server are synced",
        );

        // close everything

        await storageA1.close(false);
        await storageA2.close(false);
        await storageServer.close(false);

        httpClient1.close();
        httpClient2.close();

        httpHandler.close();

        controller.abort("End of test");
    },
});
