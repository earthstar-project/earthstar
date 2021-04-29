var __create = Object.create;
var __defProp = Object.defineProperty;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __markAsModule = (target) => __defProp(target, "__esModule", {value: true});
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {get: all[name], enumerable: true});
};
var __reExport = (target, module2, desc) => {
  if (module2 && typeof module2 === "object" || typeof module2 === "function") {
    for (let key of __getOwnPropNames(module2))
      if (!__hasOwnProp.call(target, key) && key !== "default")
        __defProp(target, key, {get: () => module2[key], enumerable: !(desc = __getOwnPropDesc(module2, key)) || desc.enumerable});
  }
  return target;
};
var __toModule = (module2) => {
  return __reExport(__markAsModule(__defProp(module2 != null ? __create(__getProtoOf(module2)) : {}, "default", module2 && module2.__esModule && "default" in module2 ? {get: () => module2.default, enumerable: true} : {value: module2, enumerable: true})), module2);
};

// src/entries/node.ts
__markAsModule(exports);
__export(exports, {
  CryptoDriverNode: () => CryptoDriverNode
});

// src/util/bytes.ts
var import_util = __toModule(require("util"));
var import_browser_or_node = __toModule(require("browser-or-node"));
var decoder;
var encoder;
if (import_browser_or_node.isNode) {
  decoder = new import_util.TextDecoder();
  encoder = new import_util.TextEncoder();
} else {
  decoder = new window.TextDecoder();
  encoder = new window.TextEncoder();
}
var bytesToBuffer = (bytes) => Buffer.from(bytes);
var bufferToBytes = (buf) => new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength / Uint8Array.BYTES_PER_ELEMENT);
var stringToBuffer = (str) => Buffer.from(str, "utf-8");
var concatBytes = (a, b) => {
  if (!b || b.length === 0) {
    return a;
  }
  if (!a || a.length === 0) {
    return b;
  }
  var c = new Uint8Array(a.length + b.length);
  c.set(a);
  c.set(b, a.length);
  return c;
};
var b64StringToBytes = (b64string) => bufferToBytes(Buffer.from(b64string, "base64"));

// src/crypto/crypto-driver-node.ts
var crypto = require("crypto");
var _generateKeypairDerBytes = () => {
  let pair = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: {
      format: "der",
      type: "spki"
    },
    privateKeyEncoding: {
      format: "der",
      type: "pkcs8"
    }
  });
  return {
    pubkey: bufferToBytes(pair.publicKey),
    secret: bufferToBytes(pair.privateKey)
  };
};
var _shortenDer = (k) => ({
  pubkey: k.pubkey.slice(-32),
  secret: k.secret.slice(-32)
});
var _derPrefixPublic = b64StringToBytes("MCowBQYDK2VwAyEA");
var _derPrefixSecret = b64StringToBytes("MC4CAQAwBQYDK2VwBCIEIA==");
var _lengthenDerPublic = (b) => concatBytes(_derPrefixPublic, b);
var _lengthenDerSecret = (b) => concatBytes(_derPrefixSecret, b);
var CryptoDriverNode = class {
  static sha256(input) {
    return bufferToBytes(crypto.createHash("sha256").update(input).digest());
  }
  static generateKeypairBytes() {
    return _shortenDer(_generateKeypairDerBytes());
  }
  static sign(keypairBytes, msg) {
    if (typeof msg === "string") {
      msg = stringToBuffer(msg);
    }
    return bufferToBytes(crypto.sign(null, msg, {
      key: bytesToBuffer(_lengthenDerSecret(keypairBytes.secret)),
      format: "der",
      type: "pkcs8"
    }));
  }
  static verify(publicKey, sig, msg) {
    if (typeof msg === "string") {
      msg = stringToBuffer(msg);
    }
    try {
      return crypto.verify(null, msg, {
        key: _lengthenDerPublic(publicKey),
        format: "der",
        type: "spki"
      }, sig);
    } catch (e) {
      return false;
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CryptoDriverNode
});
