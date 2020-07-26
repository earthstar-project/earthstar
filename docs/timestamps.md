2020-07-17

How does Earthstar handle timestamps, and can it recover from a device with a very inaccurate clock?

### How Earthstar manages timestamps

For background, the rules of Earthstar say that each document is independent and any document can be missing.  So we can't use Merkle hash backlinks for ordering, we have to use something like integers which can be put in order even if there are gaps.

We trust users to write their own timestamps.  Some exploits:
1. Write with an artificially old timestamp
2. Write with a timestamp in the future, maybe to get your post at the top of a sorted feed
3. Write with a timestamp of MAX_INTEGER or whatever, to cause overflow problems for the next writer

Documents are considered invalid if their timestamp is from more than 10 minutes in the future.  That means they can't sync across the network until time catches up with them.  This prevents attacks 2 and 3.

So timestamps are acting as sequence-numbers-with-gaps that have the extra power to prevent attacks 2 and 3 because you can loosely compare them with wall clocks which form a very rough consensus reality.

Attack 1 doesn't impact replication or conflict resolution much.  It might have implications at the application layer (like pretending a post is older than it is).  I just added an issue to [also remember timestamps for when a document was received](https://github.com/cinnamon-bun/earthstar/issues/30) to help with this.

### Handling clock glitches

An Earthstar client can write document timestamps in any order -- they don't have to monotonically increase -- so if you rewind your device clock, you just start using lower timestamps.

The exception is that when you overwrite a specific document, you set the new timestamp to `max(oldDoc.timestamp + 1, now())` to make sure your new version is the winner.

If you accidentally write a doc with a far-future timestamp it will be unable to sync off your device (assuming other devices have accurate clocks).  To fix it, you can locally delete that doc and replace it with a fresh one with an accurate timestamp.

### Failure cases

If some devices are 15 minutes fast, their writes will trickle out to the network as each other device accepts them within the 10 minute tolerance.  Other people's immediate updates to those documents will be forced to have timestamps around the 10 minute limit.  Writes that surf the 10 minute frontier won't really break, they'll just take a few minutes to sync through the whole network as each client decides they're valid according to their own clock.

If many devices have very inaccurate timestamps, the network will fragment.  Devices in the future will see more content but their writes won't reach everyone.  Devices in the past will see less content but their writes will propagate further.

Device clocks in off-the-grid settings could be very inaccurate. In those settings Earthstar just won’t work well unless you remove the block on future timestamps. That’s ok if you trust everyone, but it allows attack 3 (timestamp integer overflow).
