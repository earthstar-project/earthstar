import { assert, assertEquals, assertNotEquals } from "../asserts.ts";

import { WorkspaceAddress } from "../../util/doc-types.ts";
import { IStorageAsync } from "../../storage/storage-types.ts";
import { StorageAsync } from "../../storage/storage-async.ts";
import { FormatValidatorEs4 } from "../../format-validators/format-validator-es4.ts";

import { isErr, NotImplementedError } from "../../util/errors.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { GlobalCryptoDriver } from "../../crypto/global-crypto-driver.ts";

import { WorkspaceQuery_Request } from "../../peer/peer-types.ts";
import { Peer } from "../../peer/peer.ts";
import { PeerClient } from "../../peer/peer-client.ts";
import { PeerServer } from "../../peer/peer-server.ts";

// TODO-DENO: Update mini-rpc to provide types
import {
  ERROR_CLASSES,
  evaluator,
  makeProxy,
} from "https://cdn.skypack.dev/@earthstar-project/mini-rpc?dts";

import { testScenarios } from "../test-scenarios.ts";
import { TestScenario } from "../test-scenario-types.ts";

// tell mini-rpc which errors to treat specially
ERROR_CLASSES.concat([
  NotImplementedError,
]);

//================================================================================

import {
  Logger,
  LogLevel,
  setDefaultLogLevel,
  setLogLevel,
} from "../../util/log.ts";

let loggerTest = new Logger("test", "whiteBright");
let loggerTestCb = new Logger("test cb", "white");
let J = JSON.stringify;

setDefaultLogLevel(LogLevel.None);
//setLogLevel('test', LogLevel.Debug);
//setLogLevel('test cb', LogLevel.Debug);
//setLogLevel('peer client', LogLevel.Debug);
//setLogLevel('peer client: do', LogLevel.Debug);
//setLogLevel('peer client: handle', LogLevel.Debug);
//setLogLevel('peer client: process', LogLevel.Debug);
//setLogLevel('peer server', LogLevel.Debug);
//setLogLevel('peer server: serve', LogLevel.Debug);

//================================================================================

export let runPeerClientServerTests = (
  scenario: TestScenario,
) => {
  const { makeDriver, name } = scenario;

  let makeStorage = (ws: WorkspaceAddress): IStorageAsync => {
    let stDriver = makeDriver(ws);
    let storage = new StorageAsync(ws, FormatValidatorEs4, stDriver);
    return storage;
  };

  let TEST_NAME = "peerClient + peerServer shared tests";
  let SUBTEST_NAME = name;

  let setupTest = async () => {
    let clientWorkspaces = [
      "+common.one",
      "+common.two",
      "+common.three",
      "+onlyclient.club",
    ];
    let serverWorkspaces = [
      "+common.one",
      "+onlyserver.club",
      "+common.two",
      "+common.three",
    ];
    let expectedCommonWorkspaces = [
      // sorted
      "+common.one",
      "+common.three",
      "+common.two",
    ];

    // make Peers
    let peerOnClient = new Peer();
    let peerOnServer = new Peer();

    // make Storages and add them to the Peers
    for (let ws of clientWorkspaces) {
      peerOnClient.addStorage(makeStorage(ws));
    }
    for (let ws of serverWorkspaces) {
      peerOnServer.addStorage(makeStorage(ws));
    }

    // make some identities
    let author1 = await Crypto.generateAuthorKeypair("onee");
    let author2 = await Crypto.generateAuthorKeypair("twoo");
    let author3 = await Crypto.generateAuthorKeypair("thre");

    if (isErr(author1)) throw author1;
    if (isErr(author2)) throw author2;
    if (isErr(author3)) throw author3;

    return {
      peerOnClient,
      peerOnServer,
      expectedCommonWorkspaces,
      author1,
      author2,
      author3,
    };
  };

  Deno.test(SUBTEST_NAME + ": getServerPeerId", async () => {
    let initialCryptoDriver = GlobalCryptoDriver;

    let { peerOnClient, peerOnServer } = await setupTest();
    assertNotEquals(
      peerOnClient.peerId,
      peerOnServer.peerId,
      "peerIds are not the same, as expected",
    );
    let server = new PeerServer(peerOnServer);
    let client = new PeerClient(peerOnClient, server);

    // let them talk to each other
    assert(true, "------ getServerPeerId ------");
    loggerTest.debug(true, "------ getServerPeerId ------");
    let serverPeerId = await client.do_getServerPeerId();
    loggerTest.debug(true, "------ /getServerPeerId ------");

    assertEquals(serverPeerId, peerOnServer.peerId, "getServerPeerId works");
    assertEquals(
      client.state.serverPeerId,
      peerOnServer.peerId,
      "setState worked",
    );

    // close Storages
    for (let storage of peerOnClient.storages()) await storage.close(true);
    for (let storage of peerOnServer.storages()) await storage.close(true);

    assertEquals(
      initialCryptoDriver,
      GlobalCryptoDriver,
      `GlobalCryptoDriver has not changed unexpectedly.  started as ${
        (initialCryptoDriver as any).name
      }, ended as ${(GlobalCryptoDriver as any).name}`,
    );
  });

  Deno.test(
    SUBTEST_NAME + ": SaltyHandshake + AllWorkspaceState + WorkspaceQuery",
    async () => {
      let initialCryptoDriver = GlobalCryptoDriver;

      let {
        peerOnClient,
        peerOnServer,
        expectedCommonWorkspaces,
        author1,
        author2,
        author3,
      } = await setupTest();
      let server = new PeerServer(peerOnServer);
      let client = new PeerClient(peerOnClient, server);
      let workspace0 = expectedCommonWorkspaces[0];
      let storage0peer = server.peer.getStorage(workspace0) as IStorageAsync;
      await storage0peer.set(author1, {
        format: "es.4",
        path: "/author1",
        content: "a1",
      });
      // this doc will be overwritten
      // the total number of docs will be 2
      await storage0peer.set(author2, {
        format: "es.4",
        path: "/author2",
        content: "a2",
      });
      await storage0peer.set(author2, {
        format: "es.4",
        path: "/author2",
        content: "a2.1",
      });

      // let them talk to each other
      assert(true, "------ saltyHandshake ------");
      loggerTest.debug(true, "------ saltyHandshake ------");
      await client.do_saltyHandshake();
      loggerTest.debug(true, "------ /saltyHandshake ------");

      assertEquals(
        client.state.serverPeerId,
        server.peer.peerId,
        `client knows server's peer id`,
      );
      assertNotEquals(
        client.state.lastSeenAt,
        null,
        "client state lastSeeenAt is not null",
      );
      assertEquals(
        client.state.commonWorkspaces,
        expectedCommonWorkspaces,
        "client knows the correct common workspaces (and in sorted order)",
      );

      assert(true, "------ allWorkspaceStates ------");
      loggerTest.debug(true, "------ allWorkspaceStates ------");
      await client.do_allWorkspaceStates();
      loggerTest.debug(true, "------ /allWorkspaceStates ------");

      assertEquals(
        Object.keys(client.state.workspaceStates).length,
        expectedCommonWorkspaces.length,
        "we now have info on the expected number of storages from the server",
      );
      let workspaceState0 = client.state.workspaceStates[workspace0];
      assert(true, "for the first of the common workspaces...");
      assertEquals(
        workspaceState0.workspace,
        expectedCommonWorkspaces[0],
        "workspace matches between key and value",
      );
      assertEquals(
        workspaceState0.serverStorageId,
        server.peer.getStorage(workspace0)?.storageId,
        "storageId matches server",
      );
      assertEquals(
        workspaceState0.serverMaxLocalIndexSoFar,
        -1,
        "server max local index so far starts at -1",
      );
      assertEquals(
        workspaceState0.clientMaxLocalIndexSoFar,
        -1,
        "client max local index so far starts at -1",
      );

      assert(true, "------ workspaceQuery ------");
      loggerTest.debug(true, "------ workspaceQuery ------");
      let workspace: WorkspaceAddress = expectedCommonWorkspaces[0];
      let workspaceState = client.state.workspaceStates[workspace];
      let storageId = workspaceState.serverStorageId;
      let startAfter = workspaceState.serverMaxLocalIndexSoFar;
      let queryRequest: WorkspaceQuery_Request = {
        workspace,
        storageId,
        query: {
          historyMode: "all",
          orderBy: "localIndex ASC",
          startAfter: { localIndex: startAfter },
          // filter
          // limit
        },
      };
      let numPulled = await client.do_workspaceQuery(queryRequest);
      loggerTest.debug(true, "------ /workspaceQuery ------");

      assertEquals(numPulled, 2, "pulled all 2 docs");
      workspaceState0 = client.state.workspaceStates[workspace0];
      assert(true, "for the first of the common workspaces...");
      assertEquals(workspaceState0.workspace, workspace0);
      assertEquals(workspaceState0.serverMaxLocalIndexOverall, 2);
      assertEquals(workspaceState0.serverMaxLocalIndexSoFar, 2);

      assert(true, "------ workspaceQuery again ------");
      loggerTest.debug(true, "------ workspaceQuery again ------");
      // continue where we left off
      workspaceState = client.state.workspaceStates[workspace];
      startAfter = workspaceState.serverMaxLocalIndexSoFar;
      queryRequest = {
        workspace,
        storageId,
        query: {
          historyMode: "all",
          orderBy: "localIndex ASC",
          startAfter: { localIndex: startAfter },
          // filter
          // limit
        },
      };
      numPulled = await client.do_workspaceQuery(queryRequest);
      loggerTest.debug(true, "------ /workspaceQuery again ------");

      assertEquals(numPulled, 0, "pulled 0 docs this time");
      assert(true, "no changes to workspaceState for this workspace");
      assertEquals(workspaceState0.workspace, workspace0);
      assertEquals(workspaceState0.serverMaxLocalIndexOverall, 2);
      assertEquals(workspaceState0.serverMaxLocalIndexSoFar, 2);

      // close Storages
      for (let storage of peerOnClient.storages()) await storage.close(true);
      for (let storage of peerOnServer.storages()) await storage.close(true);

      assertEquals(
        initialCryptoDriver,
        GlobalCryptoDriver,
        `GlobalCryptoDriver has not changed unexpectedly.  started as ${
          (initialCryptoDriver as any).name
        }, ended as ${(GlobalCryptoDriver as any).name}`,
      );
    },
  );

  Deno.test(SUBTEST_NAME + ": saltyHandshake with mini-rpc", async () => {
    let initialCryptoDriver = GlobalCryptoDriver;

    let { peerOnClient, peerOnServer, expectedCommonWorkspaces } =
      await setupTest();

    // create Client and Server instances
    let serverLocal = new PeerServer(peerOnServer);
    let serverProxy = makeProxy(serverLocal, evaluator);

    // make a client that uses the proxy
    let client = new PeerClient(peerOnClient, serverProxy);

    // let them talk to each other
    assert(true, "------ saltyHandshake ------");
    let serverPeerId = await client.do_getServerPeerId();
    assertEquals(serverPeerId, peerOnServer.peerId, "getServerPeerId works");
    assertEquals(
      client.state.serverPeerId,
      peerOnServer.peerId,
      "setState worked",
    );

    await client.do_saltyHandshake();

    assertEquals(
      client.state.serverPeerId,
      serverLocal.peer.peerId,
      `client knows server's peer id`,
    );
    assertNotEquals(
      client.state.lastSeenAt,
      null,
      "client state lastSeeenAt is not null",
    );
    assertEquals(
      client.state.commonWorkspaces,
      expectedCommonWorkspaces,
      "client knows the correct common workspaces (and in sorted order)",
    );

    // close Storages
    for (let storage of peerOnClient.storages()) await storage.close(true);
    for (let storage of peerOnServer.storages()) await storage.close(true);

    assertEquals(
      initialCryptoDriver,
      GlobalCryptoDriver,
      `GlobalCryptoDriver has not changed unexpectedly.  started as ${
        (initialCryptoDriver as any).name
      }, ended as ${(GlobalCryptoDriver as any).name}`,
    );
  });
};
