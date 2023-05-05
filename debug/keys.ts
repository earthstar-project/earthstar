const keyPair = await crypto.subtle.generateKey(
  {
    name: "ECDH",
    namedCurve: "P-256",
  },
  true,
  ["deriveKey", "deriveBits"],
);

const publicKeyExported = await crypto.subtle.exportKey(
  "raw",
  keyPair.publicKey,
);

console.log(publicKeyExported.byteLength);

const publicKeyImported = await crypto.subtle.importKey(
  "raw",
  publicKeyExported,
  {
    name: "ECDH",
    namedCurve: "P-256",
  },
  true,
  [],
);

// Derive a new thing

const keyPair2 = await crypto.subtle.generateKey(
  {
    name: "ECDH",
    namedCurve: "P-256",
  },
  true,
  ["deriveKey", "deriveBits"],
);

const derivedKey = await crypto.subtle.deriveKey(
  { name: "ECDH", public: publicKeyImported },
  keyPair2.privateKey,
  { name: "AES-GCM", length: 256 },
  true,
  ["encrypt", "decrypt"],
);

// Encrypt...

const message = "Hello, there! This is my secret message.";

const iv = crypto.getRandomValues(new Uint8Array(16));

const encrypted = await crypto.subtle.encrypt(
  {
    name: "AES-GCM",
    iv,
  },
  derivedKey,
  new TextEncoder().encode(message),
);

// Decrypt
const decrypted = await crypto.subtle.decrypt(
  {
    name: "AES-GCM",
    iv,
  },
  derivedKey,
  encrypted,
);

console.log(new TextDecoder().decode(encrypted));
console.log(new TextDecoder().decode(decrypted));

const t = crypto.getRandomValues(new Uint8Array(4));

const dv = new DataView(t.buffer);

console.log(dv.getUint32(0));
