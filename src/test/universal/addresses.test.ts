import { assert, assertEquals } from "../asserts.ts";
import { snowmanString } from "../test-utils.ts";

import { AuthorAddress, ParsedAddress, ShareAddress } from "../../util/doc-types.ts";
import { isErr, notErr } from "../../util/errors.ts";
import {
    assembleAuthorAddress,
    assembleShareAddress,
    checkAuthorIsValid,
    checkShareIsValid,
    parseAuthorAddress,
    parseShareAddress,
} from "../../core-validators/addresses.ts";

//================================================================================

Deno.test("assemble addresses", () => {
    // note that this function doesn't check if the result is valid
    assertEquals(
        assembleAuthorAddress("suzy", "bxxx"),
        "@suzy.bxxx",
        "assembleAuthorAddress",
    );
    assertEquals(
        assembleShareAddress("gardening", "party"),
        "+gardening.party",
        "assembleShareAddress",
    );
});

type AuthorAddressVector = {
    valid: boolean;
    address: AuthorAddress;
    parsed?: ParsedAddress;
    note?: string;
};
Deno.test("parseAuthorAddress", () => {
    let vectors: AuthorAddressVector[] = [
        {
            valid: true,
            address: "@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            parsed: {
                address: "@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                name: "suzy",
                pubkey: "bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            },
            note: "normal address",
        },
        {
            valid: true,
            address: "@s999.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            parsed: {
                address: "@s999.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                name: "s999",
                pubkey: "bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            },
            note: "normal address, name contains number but does not start with number",
        },
        { valid: false, address: "", note: "empty string" },
        { valid: false, address: "@", note: "just a @" },
        { valid: false, address: ".", note: "just a ." },
        { valid: false, address: "@.", note: "just a @." },
        { valid: false, address: "@suzy.", note: "no key" },
        { valid: false, address: "@suzy", note: "just a name" },
        { valid: false, address: "suzy", note: "just a word" },
        {
            valid: false,
            address: "@.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "no name",
        },
        {
            valid: false,
            address: "@bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "just a key",
        },

        {
            valid: false,
            address: "@suzy@bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "@ instead of .",
        },
        {
            valid: false,
            address: "suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "no @",
        },
        {
            valid: false,
            address: "+suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "starts with +",
        },
        {
            valid: false,
            address: "@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "key too short (52 chars)",
        },
        {
            valid: false,
            address: "@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "key too long (54 chars)",
        },
        {
            valid: false,
            address: "@suzybxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "no period",
        },
        {
            valid: false,
            address: "@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.extra",
            note: "too many periods (and too long)",
        },
        {
            valid: false,
            address: "@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxx",
            note: "too many periods (53 chars)",
        },
        {
            valid: false,
            address: "@suz.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "name too short",
        },
        {
            valid: false,
            address: "@suzyy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "name too long",
        },
        {
            valid: false,
            address: " @suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "leading space",
        },
        {
            valid: false,
            address: "@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx ",
            note: "trailing space",
        },
        {
            valid: false,
            address: "@suzy.bxxxxxxxxxxxxxxxx xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "space in the middle",
        },
        {
            valid: false,
            address: "@SUZY.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "capital name",
        },
        {
            valid: false,
            address: "@suzy.bXXXXXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "capital key",
        },
        {
            valid: false,
            address: "@suzy.7xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "key starts with a number (53 chars)",
        },
        {
            valid: false,
            address: "@suzy.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "key without leading b (53 chars)",
        },
        {
            valid: false,
            address: "@suzy.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "key without leading b (52 chars)",
        },
        {
            valid: false,
            address: "@1uzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "name starts with number",
        },
        {
            valid: false,
            address: "@su?y.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "question mark in name",
        },
        {
            valid: false,
            address: "@su y.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "space in name",
        },
        {
            valid: false,
            address: "@su\ny.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "newline in name",
        },
        {
            valid: false,
            address: "@su-y.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "dash in name",
        },
        {
            valid: false,
            address: "@su_y.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "underscore in name",
        },
        {
            valid: false,
            address: "@su+y.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "+ in middle of name",
        },
        {
            valid: false,
            address: "@suzy.bxxxxxx+xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "+ in middle of key",
        },
        {
            valid: false,
            address: "@su@y.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "@ in middle of name",
        },
        {
            valid: false,
            address: "@suzy.bxxxxxx@xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "@ in middle of key",
        },
        {
            valid: false,
            address: "@suzy.bx?xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "question mark in key",
        },
        {
            valid: false,
            address: "@@suzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "double @ + 4 letter name",
        },
        {
            valid: false,
            address: "@@uzy.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "double @ + 3 letter name",
        },
        {
            valid: false,
            address: `@suz${snowmanString}.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
            note: "snowman in name + 3 letters",
        },
        {
            valid: false,
            address: `@su${snowmanString}.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
            note: "snowman in name + 2 letters",
        },
        {
            valid: false,
            address: `@s${snowmanString}.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
            note: "snowman in name + 1 letter",
        },
        { valid: false, address: 123 as any as string, note: "a number" },
        {
            valid: false,
            address: undefined as any as string,
            note: "undefined",
        },
        { valid: false, address: null as any as string, note: "null" },

        // TODO: more carefully check b32 characters -- should we try to decode the b32 just to make sure it's ok?
        {
            valid: false,
            address: "@suzy.b01xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "invalid b32 characters in key (0, 1)",
        },
    ];
    for (let v of vectors) {
        if (v.valid) {
            assertEquals(
                parseAuthorAddress(v.address),
                v.parsed,
                "should be parsable: " + (v.note || v.address),
            );
            assert(
                notErr(checkAuthorIsValid(v.address)),
                "should be valid:    " + (v.note || v.address),
            );
        } else {
            assert(
                isErr(parseAuthorAddress(v.address)),
                "should be unparsable: " + (v.note || v.address),
            );
            assert(
                isErr(checkAuthorIsValid(v.address)),
                "should be invalid:    " + (v.note || v.address),
            );
        }
    }
});

type ShareAddressVector = {
    valid: boolean;
    address: ShareAddress;
    parsed?: ParsedAddress;
    note?: string;
};
Deno.test("parseShareAddress", () => {
    let vectors: ShareAddressVector[] = [
        {
            valid: true,
            address: "+gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            parsed: {
                address: "+gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                name: "gardening",
                pubkey: "bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            },
            note: "normal address with long b32 pubkey",
        },
        {
            valid: true,
            address: "+gardening.bxxxx",
            parsed: {
                address: "+gardening.bxxxx",
                name: "gardening",
                pubkey: "bxxxx",
            },
            note: "normal address with short random b32",
        },
        {
            valid: true,
            address: "+a.b",
            parsed: {
                address: "+a.b",
                name: "a",
                pubkey: "b",
            },
            note: "normal address with 1 character name and 1 character key starting with b",
        },
        {
            valid: true,
            address: "+a.x",
            parsed: {
                address: "+a.x",
                name: "a",
                pubkey: "x",
            },
            note: "normal address with 1 character name and 1 character key not starting with b",
        },
        {
            valid: true,
            address: "+aaaaabbbbbccccc.bxxxx",
            parsed: {
                address: "+aaaaabbbbbccccc.bxxxx",
                name: "aaaaabbbbbccccc",
                pubkey: "bxxxx",
            },
            note: "normal address with 15 character name",
        },
        {
            valid: true,
            address: "+gardening.r0cks", // note that zero is not in the b32 character set
            parsed: {
                address: "+gardening.r0cks",
                name: "gardening",
                pubkey: "r0cks",
            },
            note: "normal address with word after period (non-b32)",
        },
        {
            valid: true,
            address: "+garden2000.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            parsed: {
                address: "+garden2000.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                name: "garden2000",
                pubkey: "bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            },
            note:
                "normal address with long pubkey, name contains number but does not start with number",
        },
        { valid: false, address: "", note: "empty string" },
        { valid: false, address: "+", note: "just a +" },
        {
            valid: false,
            address: "gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "no +",
        },
        {
            valid: false,
            address: "@gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "starts with @",
        },
        {
            valid: false,
            address: "+gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "key too long (54 chars)",
        },
        {
            valid: false,
            address: "+gardeningbxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "no period",
        },
        {
            valid: false,
            address: "+gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.extra",
            note: "too many periods",
        },
        {
            valid: false,
            address: "+aaaaabbbbbcccccd.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "name too long (16 characters)",
        },
        {
            valid: false,
            address: "+.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "no name",
        },
        {
            valid: false,
            address: "+bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "just a key",
        },
        { valid: false, address: "+gardening.", note: "no key" },
        { valid: false, address: "+gardening", note: "just a name" },
        { valid: false, address: "gardening", note: "just a word" },
        {
            valid: false,
            address: " +gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "leading space",
        },
        {
            valid: false,
            address: "+gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx ",
            note: "trailing space",
        },
        {
            valid: false,
            address: "+gardening.bxxxxxxxxxxxxxxxx xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "space in the middle",
        },
        {
            valid: false,
            address: "+GARDENING.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "capital name",
        },
        {
            valid: false,
            address: "+gardening.bXXXXXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "capital key",
        },
        {
            valid: false,
            address: "+1garden.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "name starts with number",
        },
        {
            valid: false,
            address: "+gar?dening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "question mark in name",
        },
        {
            valid: false,
            address: "+gar den.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "space in name",
        },
        {
            valid: false,
            address: "+gar\nden.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "newline in name",
        },
        {
            valid: false,
            address: "+gar-den.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "dash in name",
        },
        {
            valid: false,
            address: "+gar_den.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "underscore in name",
        },
        {
            valid: false,
            address: "+gar+den.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "+ in middle of name",
        },
        {
            valid: false,
            address: "+garden.bxx+xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "+ in middle of key",
        },
        {
            valid: false,
            address: "+gar@den.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "@ in middle of name",
        },
        {
            valid: false,
            address: "+garden.bxx@xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "@ in middle of key",
        },
        {
            valid: false,
            address: "+gardening.bx?xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "question mark in key",
        },
        {
            valid: false,
            address: "++gardening.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            note: "double +",
        },
        {
            valid: false,
            address:
                `+garden${snowmanString}.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
            note: "snowman in name",
        },
    ];
    for (let v of vectors) {
        if (v.valid) {
            assertEquals(
                parseShareAddress(v.address),
                v.parsed,
                "should be parsable: " + (v.note || v.address),
            );
            assert(
                notErr(checkShareIsValid(v.address)),
                "should be valid:    " + (v.note || v.address),
            );
        } else {
            assert(
                isErr(parseShareAddress(v.address)),
                "should be unparsable: " + (v.note || v.address),
            );
            assert(
                isErr(checkShareIsValid(v.address)),
                "should be invalid:    " + (v.note || v.address),
            );
        }
    }
});
