require("fake-indexeddb/auto"); // HAS to come first for Node.js
const LFS = require('@isomorphic-git/lightning-fs');

import {execSync} from 'child_process';
import {mkdirSync, promises} from 'fs';
import tape from 'tape';

import {Gatty, gitReset, setup, sync} from './index';

const git = require('isomorphic-git');
const fs = require('fs');
const rimrafFull = require('rimraf');
import {promisify} from 'util';
const rimraf = promisify(rimrafFull);
const Server = require('node-git-server');

function slug(s: string) { return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, '') }
const events = 'hello!,hi there!,how are you?'.split(',');
const uids = events.map(slug);

const REMOTEDIR = 'github';

type F = typeof fs;
type P = typeof promises;

async function multiLimit(t: tape.Test, fs: F, promises: P, eventFileSizeLimitBytes = 900, DIR = 'whee') {
  // const DIR = 'whee';
  const DIR2 = DIR + '2';

  git.plugins.set('fs', fs);

  await directoryCleanup(fs, DIR, DIR2);

  // Initialize remote repo
  mkdirSync(REMOTEDIR);
  execSync(`git init && echo Welcome > README.md && git add README.md && git commit -am init`, {cwd: REMOTEDIR})

  // create bare remote repo so we can (mock) push to it
  execSync(`git clone --bare ${REMOTEDIR} ${REMOTEDIR}.git`);

  // Start the mock git server
  const SERVER = new Server(__dirname);
  const PORT = 8174;
  {
    SERVER.on('push', (push: any) => { push.accept(); });
    SERVER.on('fetch', (fetch: any) => { fetch.accept(); });
    SERVER.listen(PORT, () => { console.log(`node-git-server running at http://localhost:${PORT}`); });
  }

  // execSync(`node_modules/.bin/git-http-mock-server start`);
  // This is the server URL
  const REMOTEURL = `http://localhost:${PORT}/${REMOTEDIR}.git`;

  // clone a device
  const init: Partial<Gatty> = {dir: DIR, eventFileSizeLimitBytes};
  const gatty = await setup(init, REMOTEURL, fs);
  t.ok(gatty, 'initial setup ok');

  // nothing to write, empty store
  {
    const {newEvents, newSharedUid} = await sync(gatty, '', [], []);
    t.equal(newSharedUid, '');
    t.deepEqual(newEvents, [], 'empty store: no new events');
    const eventFiles = new Set(await promises.readdir(DIR + '/_events'));
    t.equal(eventFiles.size, 0, 'no files in event directory');
    const uniqueFiles = new Set(await promises.readdir(DIR + '/_uniques'));
    t.equal(uniqueFiles.size, 0, 'no files in unique directory');

    const commits = await git.log({dir: DIR, depth: 5000});
    t.equal(commits.length, 1, 'only 1 commit, from remote');
  }

  // // Write new events to empty store
  {
    const {newEvents, newSharedUid} = await sync(gatty, '', uids, events);
    t.equal(newSharedUid, uids[uids.length - 1], 'shared last event');
    t.deepEqual(newEvents, [], 'no new events');

    const eventFiles = new Set(await promises.readdir(DIR + '/_events'));
    const uniqueFiles = new Set(await promises.readdir(DIR + '/_uniques'));

    if (eventFileSizeLimitBytes > 500) {
      t.equal(eventFiles.size, 1, 'only one event file on disk');
    } else {
      t.ok(eventFiles.size > 1, 'more than one event file');
    }
    t.ok(eventFiles.has('1'), 'expected event file found on dist');
    t.equal(uniqueFiles.size, uids.length, 'expected # of uniques on disk');
    uids.forEach(u => t.ok(uniqueFiles.has(`${u}`), 'unique file created'));

    const commits = await git.log({dir: DIR, depth: 5000});
    t.equal(commits.length, 2, 'now 2 commits');
  }

  // No new events, just checking for remotes
  {
    const {newEvents, newSharedUid} = await sync(gatty, last(uids), uids, events);
    // console.log({newEvents, newSharedUid});
    t.deepEqual(newEvents, [], 'no new events from remote');
    t.equal(newSharedUid, last(uids), 'idempotent even though we "added" them');

    const commits = await git.log({dir: DIR, depth: 5000});
    t.equal(commits.length, 2, 'still 2 commits');

    const uniqueFiles = await promises.readdir(DIR + '/_uniques');
    t.equal(uniqueFiles.length, events.length);
  }

  // Append new events, no new events on remote
  {
    let events2 = 'chillin,cruisin,flying'.split(',');
    let uids2 = events2.map(slug);
    const {newEvents, newSharedUid} = await sync(gatty, last(uids), uids2, events2);
    t.ok(newEvents, 'sync succeeded');
    const commits = await git.log({dir: DIR, depth: 5000});
    const uniqueFiles = await promises.readdir(DIR + '/_uniques');
    const eventsList = await catEvents(gatty, promises);
    console.log(eventsList);

    t.deepEqual(newEvents, [], 'no new events from remote');
    t.equal(newSharedUid, last(uids2), 'last unique present');
    t.equal(commits.length, 3, 'now 3 commits');
    t.equal(uniqueFiles.length, events.length + events2.length, 'all events have uniques');
    t.equal(eventsList.trim().split('\n').length, events.length + events2.length, 'all events available');
  }

  // NEW device that has only partial store (the first 3 events from the first commit), with events of its own
  {
    const gatty2 = await cloneAndRollback(gatty, REMOTEURL, 1, DIR2);

    let events2 = 'ichi,ni,san'.split(',');
    let uids2 = events2.map(slug);
    const {newEvents, newSharedUid} = await sync(gatty2, last(uids), uids2, events2);
    const commits = await git.log({dir: DIR2, depth: 5000});
    const uniqueFiles = await promises.readdir(DIR2 + '/_uniques');
    const eventsList = await catEvents(gatty2, promises);

    t.deepEqual(newEvents, ['chillin', 'cruisin', 'flying'].map(payload => [slug(payload), payload]),
                'got correct remote events');
    t.equal(newSharedUid, last(uids2), 'updated up to last local unique');
    t.equal(commits.length, 4, 'now 4 commits');
    t.equal(uniqueFiles.length, events.length + events2.length + 3, 'all 9 events have uniques')
    t.equal(eventsList.trim().split('\n').length, 9, 'all 9 events available');

    await rimraf(DIR2, fs);
  }

  // fresh new device, with events to commit, nothing in store
  {
    const gatty2 = await cloneAndRollback(gatty, REMOTEURL, 3, DIR2);

    let events2 = 'never,give,up'.split(',');
    let uids2 = events2.map(slug);
    const {newEvents, newSharedUid} = await sync(gatty2, '', uids2, events2);
    const eventsMap = new Map(newEvents);
    const commits = await git.log({dir: DIR2, depth: 5000});
    const uniqueFiles = await promises.readdir(DIR2 + '/_uniques');
    const eventsList = await catEvents(gatty2, promises);

    t.equal(newEvents.length, 9, '9 remote events retrieved');
    t.equal(newSharedUid, last(uids2), 'updated up to last local unique');
    t.equal(commits.length, 5, 'now 5 commits');
    t.equal(uniqueFiles.length, events.length + events2.length + 3 + 3, 'all 12 events have uniques')
    t.equal(eventsList.trim().split('\n').length, 12, 'all 12 events available');
    for (const payload of 'ichi,ni,san,chillin,cruisin,flying,hello!,hi there!,how are you?'.split(',')) {
      const uid = slug(payload); // we make uid via `slug`.
      t.ok(eventsMap.has(uid), uid + ' present');
      t.equal(eventsMap.get(uid), payload, payload + ' present');
    }

    await rimraf(DIR2, fs);
  }

  // fresh new device, NO events of its own, NOTHING to store: the most common case!
  {
    const init: Partial<Gatty> = {pfs: promises, dir: DIR2, eventFileSizeLimitBytes};
    const gatty2 = await setup(init, REMOTEURL, fs);
    const {newEvents, newSharedUid} = await sync(gatty2, '', [], []);

    t.equal(newEvents.length, 9 + 3, 'all 12 remote events retrieved');
    t.ok(newSharedUid, 'newSharedUid is NOT empty');
    t.equal(newSharedUid, slug(last(newEvents)[0]), 'newSharedUid is slug-version of last payload');

    await rimraf(DIR2, fs);
  }

  // Force rollback
  {
    const DIR3 = DIR + '3';
    await rimraf(DIR2, fs);
    await rimraf(DIR3, fs);

    await git.clone({dir: DIR2, url: REMOTEURL});
    await git.clone({dir: DIR3, url: REMOTEURL});
    const gatty2 = {...gatty, dir: DIR2};
    const gatty3 = {...gatty, dir: DIR3};

    let events2 = 'im,first'.split(',');
    let uids2 = events2.map(slug);

    let events3 = 'iwas,second,doh'.split(',');
    let uids3 = events3.map(slug);

    const {newEvents: newEvents2, newSharedUid: newSharedUid2} = await sync(gatty2, 'up', uids2, events2);

    // For device 3, skip the initial pull. This simulates the condition where device2 and device3 both pull+push at the
    // same time but the remote store gets device2's first, so device3's push will fail. This is a hyperfine edge case.
    const backup = git.pull;
    let pullSkipCount = 0;
    git.pull = (...args: any) => {
      t.comment('FAKE GIT PULL, SKIPPING, but replacing');
      pullSkipCount++;
      git.pull = backup;
    };

    const {newEvents: newEvents3, newSharedUid: newSharedUid3} = await sync(gatty3, 'up', uids3, events3);

    const commits = await git.log({dir: DIR3, depth: 5000});
    const uniqueFiles = await promises.readdir(DIR3 + '/_uniques');
    const eventsList = await catEvents(gatty3, promises);

    t.equal(pullSkipCount, 1, 'we did skip a pull and caused a conflict');
    t.equal(commits.length, 7, 'device3 picked up all commits');
    // hello + chilling + ichi + never + im + doh = 3 + 3 + 3 + 3 + 2 + 3
    t.equal(uniqueFiles.length, events.length + 3 + 3 + 3 + 2 + 3, 'device3 got all uniques')
    t.equal(eventsList.trim().split('\n').length, events.length + 3 + 3 + 3 + 2 + 3, 'and all events');

    t.equal(newEvents2.length, 0, 'dev2 got nothing new');
    t.equal(newSharedUid2, last(uids2));
    t.equal(newEvents3.length, 2, 'dev3 got two remotes from dev2');
    t.equal(newSharedUid3, last(uids3));

    const contents = await promises.readdir(`${DIR3}/_events`);
    console.log({contents});

    await rimraf(DIR2, fs);
    await rimraf(DIR3, fs);
  }

  SERVER.close();
  await directoryCleanup(fs, DIR, DIR2);
}

// MAIN TAPE INVOKATIONS

tape('intro', async function(t) {
  await multiLimit(t, fs, promises, 900);
  t.end();
});

tape('small size', async function(t) {
  await multiLimit(t, fs, promises, 4);
  t.end();
});

tape('with lightningfs, intro', async function(t) {
  // await multiLimit(t, fs, promises, 900);
  const fs = new LFS("testfs", {wipe: true});
  const pfs = fs.promises;
  await multiLimit(t, fs, pfs, 900, '/whee');
  t.end();
});

tape('with lightningfs, small size', async function(t) {
  // await multiLimit(t, fs, promises, 4);
  const fs = new LFS("testfs2", {wipe: true});
  const pfs = fs.promises;
  await multiLimit(t, fs, pfs, 4, '/whee');
  t.end();
});

// HELPER FUNCTIONS ONLY

async function catEvents({pfs, dir}: Gatty, promises: P) {
  const evDir = dir + '/_events';
  const files = await promises.readdir(evDir);
  const contents = await Promise.all(files.map(file => promises.readFile(evDir + '/' + file, 'utf8')));
  return contents.join('');
}

// function sleep(ms: number) { return new Promise(resolve => {setTimeout(resolve, ms)}); }
function last<T>(arr: T[]): T {
  if ((arr.length - 1) in arr) { return arr[arr.length - 1]; }
  throw new Error('out-of-bounds');
}

async function cloneAndRollback(init: Gatty, url: string, roll: number, DIR2: string): Promise<Gatty> {
  const gatty2 = {...init, dir: DIR2};
  await git.clone({dir: DIR2, url});
  await gitReset({pfs: gatty2.pfs, git, dir: DIR2, ref: "HEAD~" + roll, branch: 'master', hard: true, cached: false});
  return gatty2;
}

async function directoryCleanup(fs: F, DIR: string, DIR2: string) {
  await rimraf(DIR, fs);
  await rimraf(DIR2, fs);
  await rimraf(REMOTEDIR);
  await rimraf(REMOTEDIR + '.git');
}