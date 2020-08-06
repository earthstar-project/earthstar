# The Rules of Earthstar

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Contents**

- [Scope](#scope)
- [Out of scope](#out-of-scope)
- [Goals and priorities](#goals-and-priorities)
- [Technical rules and invariants](#technical-rules-and-invariants)
- [App rules](#app-rules)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Scope

Earthstar is mostly a **format for distributed data** and associated **user identities**.

* Verifying data was made by a certain identity and was not tampered with
* Merging data conflicts
* Grouping data and people into "workspaces"
* Mostly focused on connecting with small groups of people you mostly trust

It's a delta-state based CRDT that works in adversarial conditions.

This data format can be moved around in any way -- sneakernet, bluetooth, HTTP, etc.  For convenience, Earthstar suggests a way to do **networking** but is less opinionated about it:

* Finding other peers
* A protocol for syncing across a network

Earthstar is a **specification** and a **reference implementation** in Typescript.

## Out of scope

* User-facing applications such as social networks are built **on top of** Earthstar.  Earthstar is a low-level tool.
* No strong anonymity guarantees -- use Earthstar across more sophisticated network tools such as Tor, I2P, VPNs, yggdrasil, zerotier, etc.

## Goals and priorities

The goal of this project is to make it easy for people and communities to have their own communications infrastructure, independent of big tech companies and people with specialized tech skills.

Priority 1: Security:

* The cryptography must be solid

Priority 2: Affordances to meet user needs:

* Delete or edit their data
* Flexibly delete their own copy of other users' data, to save storage space
* Partially sync only the data they want from other peers
* Use a single identity from multiple devices
* Robust blocking and abuse prevention tools (mostly provided by apps built on top of Earthstar, using the flexibility of Earthstar's data model)
* Private messages (not implemented yet)
* Phishing and impersonation resistance

Priority 3: Diffusion of power and control:

* Design for many small self-sufficient groups of users, not one giant interlinked one
* Reduce the distinction between sysadmins and users:
    * Users must be able to run their own infrastructure (servers) without much tech expertise, so that a community is self-sufficient
    * And/or, servers should be unneccesary
* People should be able to start a group from scratch without already knowing someone who is using Earthstar
* Work offline

Priority 4: Code simplicity, to democratize implementation and understanding:

* Use well-known, "boring" technologies and programming paradigms
* Use simple algorithms
* Write lots of documentation
* Minimize dependencies

Priority 5: Backwards compatability

* Preserve the ability to read old Earthstar data
* Bump the format version (e.g. "es.4" and ValidatorES4) when making changes
* Storage classes should support multiple validators -- this lets them handle old and new data at the same time

## Technical rules and invariants

Workspaces are completely independent of each other:

* Users may or may not choose to re-use their identities across workspaces
* Documents are bound to a specific workspace.  They can't be synced between different workspaces.

Documents must be strictly validated:

* Peers can send you broken or malicious data
* Document timestamps are set by the author, so they can't be trusted
* Every document must be strictly validated (valid signature, validly formatted author string, etc.)
    * Validation happens when receiving a document from another peer ("ingesting") and when writing a new document locally.

There will be gaps in the data:

* Earthstar data is an **unordered collection** of document versions.  It's not an append-only log.
* Applications have to accept some uncertainty when handling Earthstar data.
* Any document can be missing, and documents can arrive in any order.
* There is no way to be sure you have every document.
* Documents are validated one at a time, statelessly, in isolation, without reference to other documents.
* To refer from one document to another, you can use its hash, but you can't guarantee you will ever have the linked document.
* Apps can sync any subset of documents they like, in any order.
* Apps can locally delete data in any way they like, for example to save space or remove unwanted content.
    * Exception: Don't delete tombstones (empty documents) just because they're empty; they need to exist so the deletion is remembered.  It's ok to delete them if they match other patterns like "old documents" or "path starts with /wiki".
* There are no transactions.  The unit of atomic change is the document.

Earthstar is not opinionated about networking:

* The data format is strict and interoperable
* The network format is a suggestion
* Use any network protocols you like
* Your app may choose a network protocol that's specialized or incompatible with other apps

Earthstar's conflict resolution is of limited sophistication, on purpose:

* Earthstar doesn't do fancy causality tracking -- it can't tell you if two document versions are a conflict (fork) or if one comes after the other.
* Earthstar's simple "latest version wins" approach will work for many applications
* Avoid conflicts and write contention by changing the application design:
    * Principle: "Accumulate many opinions" instead of "fight over the one canonical document"
    * Have people create new documents instead of overwriting other peoples' documents.
        * Example: can users add comments to something instead of editing the original?
    * Use many small documents instead of a few large documents.
        * Example: a wiki page could be made from several small documents, one for each paragraph, instead of one large document.  This reduces the chance of edit collisions in a document.
    * But, strike a balance; with very small documents you may not have all the parts of the data you need, or some may be older than others.  Large documents will always be completely present and internally consistent.
* If this is not enough, you can let the user resolve conflicts by hand by picking between all the document versions in a certain path.
* Applications requiring better causality tracking can try to add this on top of Earthstar:
    * We can't use hash backlinks or Merkle trees because there will be missing documents that will break the chain
    * Instead, use version vectors.  Add them, and device IDs, into the document content.  This is not a core feature of Earthstar.
    * The version vector is specific to this path.  It's a map from `author+device --> highest timestamp seen from that author and device, at this path`,
    * But: we keep the latest document version from each author, not each device
    * ...because this ensures each author can overwrite their own data from any device, not just the one they used originally
    * Hopefully this strategy will still work with some missing documents from the author's other devices
    * See [fancy-conflict-resolution.md](fancy-conflict-resolution.md) for more
* If your application needs more causalitry tracking than this, Earthstar is a poor choice.

## App rules

Prevent spidering of data

* Workspaces are accessible by anyone who knows the long random address, so the address must be kept secret.
* Users share and discover workspaces by talking outside of Earthstar.
* Workspaces should not be discoverable over the network -- don't provide a list of workspaces held by a peer.

Earthstar apps should work offline and on low-bandwidth connections:

* Prioritize the data you want and sync it first
* Then sync the data you might need later when you're offline
* The app should continue to work without a network connection
* Expect that users may return after a long time offline, maybe months.  This should not break anything.
    * This means we have to keep the tombstones of old deleted data forever

Deletion is best-effort harm reduction

* Data MUST only be held by the mutual consent of the author and the one holding the data.  Consent may be withdrawn by either.  The author may overwrite or delete data and that must be honored; the one holding the data may also choose to stop hosting it.
* So, Earthstar implementations MUST not keep logs of old data that was deleted or overwritten.
* We have no way of verifying that other peers are following this rule.
* Practically, deletion is a gradient.  Every place the unwanted data exists increases the chance of bad outcomes.  The goal is to reduce the number of places where the data occurs as much as possible.

Clearly communicate privacy and security properties to users.

* From using an app, users MUST be able to learn:
    * The consequences of losing their secret key
    * Forgotten secret keys can't be recovered
    * Who can know their IP address, and what that means
    * Who can see their data
    * That other peers are capable of storing their deleted data
    * How blocking / muting works

Blocking and harassment prevention

* This is not yet a low-level Earthstar feature, but it should be
    * Need to define a standard format to store this data
* Apps should allow users to "mute" or "hide" other users and their data
* Apps should clearly communicate that this is a one-way action: the muted user can still see you.
* Apps should allow "delegated muting", e.g. you can inherit lists of muted people from other people you trust.
* Apps should locally delete the data of muted users, maybe except for their name and profile information
