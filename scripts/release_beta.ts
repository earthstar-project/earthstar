// Make sure we're on squirrel
console.group("Checking branch...");

const currentBranch = await run([
  "git",
  "rev-parse",
  "--abbrev-ref",
  "HEAD",
]);

if (currentBranch !== "squirrel") {
  console.error("Trying to cut a release from a branch other than squirrel.");
  Deno.exit(1);
} else {
  console.log("squirrel ✔");
}

console.groupEnd();

// Get the last tag and bump it
console.group("Bumping tag...");

const lastTag = await run([
  "git",
  "describe",
  "--tags",
  "--abbrev=0",
]);

const regex = /v10.0.0-beta.(\d+)/;

const match = lastTag.match(regex);

let nextTag: string;

if (match) {
  const nextNum = parseInt(match[1]) + 1;
  nextTag = `v10.0.0-beta.${nextNum}`;
} else {
  nextTag = `v10.0.0-beta.1`;
}

console.log(`Next tag: ${nextTag}`);

console.groupEnd();

console.group("Creating web bundle...");
await run(["deno", "task", "bundle", nextTag]);
console.log("... done.");
console.groupEnd();

// Call NPM with new version
console.group("Creating NPM distribution...");
await run(["deno", "task", "npm", nextTag]);

console.log("... done.");
console.groupEnd();

console.group("Creating web bundle...");
await run(["deno", "task", "bundle", nextTag]);
console.log("... done.");
console.groupEnd();

const proceed = confirm(`Publish ${nextTag} to git and NPM?`);

if (proceed) {
  console.group("Creating release...");

  // Create tag and push to remote
  console.log("Creating git tag...");
  await run(["git", "tag", nextTag]);

  // Push to origin
  console.log("Pushing git tag to origin...");
  await run(["git", "push", "origin", nextTag]);

  console.log("Publishing to NPM...");
  await run(["npm", "publish", "./npm", "--tag", "beta"]);

  console.groupEnd();

  console.log(`Released ${nextTag}`);
} else {
  console.log("Aborted release.");
  Deno.exit(0);
}

async function run(cmd: string[], cwd?: string): Promise<string> {
  const process = Deno.run({
    cmd,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });

  const { code } = await process.status();

  if (code === 0) {
    return new TextDecoder().decode(await process.output()).trim();
  } else {
    console.error(new TextDecoder().decode(await process.stderrOutput()));
    Deno.exit(1);
  }
}
