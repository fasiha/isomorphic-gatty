# Gatty

I put the following in a big kettle, simmered for a few months, and published the resulting package:
- [isomorphic-git](https://isomorphic-git.org)
- append-only event logs
- Ink and Switch’s essay [“Local-first software”](https://www.inkandswitch.com/local-first.html)
- BYOS (bring your own storage)
- browser and Node.js

## Installation

Usually in this section I’d start out by telling people to install [Node.js](https://nodejs.org) and [Git](https://git-scm.com) but this project won’t make much sense if you’re not already intimately familiar with those two kingdoms.

So. Assuming you have a Node.js project already:
```
$ npm i --save isomorphic-gatty
```
and in your JavaScript/TypeScript code:
```js
import {Gatty, setup, sync} from 'isomorphic-gatty';
```

If you’re making a browser app without Node, grab [index.bundle.min.js](index.bundle.min.js), rename it `gatty.bundle.min.js` and invoke it in your HTML:
```html
<script src="gatty.bundle.min.js"></script>
```
It’s around 384 kilobytes unzipped, roughly 100 kilobytes gzipped.

## Usage and API
Gatty is intended to be used in conjunction with a user-facing local-first application. “Local-first” means the app keeps all user data local, and uses Gatty/isomorphic-git as one strategy for backup and multi-device data synchronization. Specifically, Gatty saves a stream of events to a git repo and synchronizes it with a remote git server (e.g., GitHub, Gitlab, Gogs, Azure Repos, etc.). The “events” are just plain strings that your app generates and understands: Gatty doesn’t know anything about them.

The envisioned use case is your app periodically calls Gatty, each time giving it the following:
- new events generated by your app (plain strings),
- a event unique identifier associated with each event—perhaps a timestamp or a random string (or both), and
- the last event unique identifier Gatty sync’d for you (empty string if you’ve never sync’d with Gatty).

Gatty in turn will return
- events (plain strings) *not* generated on this device, i.e., by your app running on another device,
- another event unique identfier that represents the last event your app–device has synchronized.

This way, the only extra thing you app keeps track of in order to use Gatty is a single unique identifier.

N.B. Gatty currently doesn’t handle offline detection. Your app should make an effort to determine online status, and invoke Gatty when it has network connectivity. As we test how this works, we’ll update this section with tips.

### **`setup`**
```ts
setup({corsProxy, branch, depth, since, username, password, token}: Partial<Gatty>, url: string): Promise<Gatty>
```
where the second argument
- `url: string`, the URL to clone from

is **required** while all the arguments of the first object are **optional** and passed directly to isomorphic-git:
- `corsProxy: string`, a CORS proxy like [https://cors.isomorphic-git.org](https://cors.isomorphic-git.org) to route all requests—necessary if you intend to push to some popular Git hosts like GitHub and Gitlab, but not to others like Gogs and Azure Repos. This proxy will see your username, tokens, Git repo information, so…
- `branch: string`, the branch of the repo you want to work with,
- `depth: number`, how many commits back to fetch,
- `since: Date`, how far back in calendar terms to fetch,
- `username: string`, username for authentication (usually pushing requires this),
- `password: string`, plaintext password for authentication (don’t use this, figure out how to use a token),
- `token: string`, a token with hopefully restricted scope for authentication.

The returned value is a promisified object of type `Gatty`, which includes these options and a couple of other internal things.

### **`sync`**
```ts
sync(gatty: Gatty, lastSharedUid: string, uids: string[], events: string[]): Promise<{newSharedUid: string, newEvents: string[]}>
```
Given a 
- `gatty` object returned by `setup`,
- `lastSharedUid`, a string representing the event unique identifier that Gatty told you it’s synchronized (use `''`, the empty string, if you’ve never synchronized),
- `uids`, an array of unique identifiers (plain strings),
- `events`, an array of events (plain strings),

Gatty will pull the latest version of the repo from the URL you gave it during `setup`, add the new events you just gave it, and find and returns the (promisified) events that you haven’t seen (`newEvents`). It also returns `newSharedUid`, the unique identifier of the last synchronized event that you have to keep track of for future calls to `sync`.

## Dev
Tape and node-git-server for testing.

Browserify for bundling.

Google Closure Compiler for minification and dead-code elimination.

TypeScript for sanity.

TODO. Create a little webapp that demonstrates this with, e.g., a GitHub Gist or something.