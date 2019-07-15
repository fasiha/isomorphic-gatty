import {execSync} from 'child_process';
import {mkdirSync, promises} from 'fs';
import globby from 'globby';
import tape from 'tape';

import {Gatty, gitReset, writer} from './index';

const git = require('isomorphic-git');
const fs = require('fs');
const rimraf = require('rimraf');
const Server = require('node-git-server');

git.plugins.set('fs', fs);

function slug(s: string) { return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, '') }
const events = 'hello!,hi there!,how are you?'.split(',').map(s => s + '\n');
const uids = events.map(slug);

const REMOTEDIR = 'github';
const REMOTEDIR2 = 'github2';
const DIR = 'whee';
const DIR2 = DIR + '2';

tape('intro', async function intro(t) {
  // delete old git dirs
  rimraf.sync(DIR);
  rimraf.sync(DIR2);
  rimraf.sync(REMOTEDIR);
  rimraf.sync(REMOTEDIR2);
  rimraf.sync(REMOTEDIR + '.git');

  const gatty: Gatty = {
    pfs: promises,
    dir: DIR,
    corsProxy: '',
    branch: '',
    depth: -1,
    since: new Date(),
    username: '',
    password: '',
    token: '',
    eventFileSizeLimit: 900
  };

  // Initialize remote repo
  mkdirSync(REMOTEDIR);
  git.init({dir: REMOTEDIR});
  await promises.writeFile(`${REMOTEDIR}/README.md`, 'Welcome!');
  await git.add({dir: REMOTEDIR, filepath: 'README.md'});
  await git.commit({dir: REMOTEDIR, message: 'Initial', author: {name: 'Gatty', email: 'gatty@localhost'}});

  // create bare remote repo so we can (mock) push to it
  execSync(`git clone --bare ${REMOTEDIR} ${REMOTEDIR}.git`);

  // Start the mock git server
  const SERVER = new Server(__dirname);
  {
    const port = 8174;
    SERVER.on('push', (push: any) => { push.accept(); });
    SERVER.on('fetch', (fetch: any) => { fetch.accept(); });
    SERVER.listen(port, () => { console.log(`node-git-server running at http://localhost:${port}`); });
  }

  // execSync(`node_modules/.bin/git-http-mock-server start`);
  // This is the server URL
  const URL = `http://localhost:8174/${REMOTEDIR}.git`;
  // clone a device
  await git.clone({dir: gatty.dir, url: URL});

  // nothing to write, empty store
  {
    const {newEvents, newSharedUid} = await writer(gatty, '', [], []);
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
    const {newEvents, newSharedUid} = await writer(gatty, '', uids, events);
    t.equal(newSharedUid, uids[uids.length - 1], 'shared last event');
    t.deepEqual(newEvents, [], 'no new events');

    const eventFiles = new Set(await promises.readdir(DIR + '/_events'));
    const uniqueFiles = new Set(await promises.readdir(DIR + '/_uniques'));

    t.equal(eventFiles.size, 1, 'only one event file on disk');
    t.ok(eventFiles.has('1'), 'expected event file found on dist');
    t.equal(uniqueFiles.size, uids.length, 'expected # of uniques on disk');
    uids.forEach(u => t.ok(uniqueFiles.has(`${u}`), 'unique file created'));

    const commits = await git.log({dir: DIR, depth: 5000});
    t.equal(commits.length, 2, 'now 2 commits');
  }

  // No new events, just checking for remotes
  {
    const {newEvents, newSharedUid} = await writer(gatty, last(uids), uids, events);
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
    let events2 = 'chillin,cruisin,flying'.split(',').map(s => s + '\n');
    let uids2 = events2.map(slug);
    const {newEvents, newSharedUid} = await writer(gatty, last(uids), uids2, events2);
    const commits = await git.log({dir: DIR, depth: 5000});
    const uniqueFiles = await promises.readdir(DIR + '/_uniques');
    const eventsList = await catEvents(gatty);

    t.deepEqual(newEvents, [], 'no new events from remote');
    t.equal(newSharedUid, last(uids2), 'last unique present');
    t.equal(commits.length, 3, 'now 3 commits');
    t.equal(uniqueFiles.length, events.length + events2.length, 'all events have uniques');
    t.equal(eventsList.trim().split('\n').length, events.length + events2.length, 'all events available');
  }

  // NEW device that has only partial store (the first 3 events from the first commit), with events of its own
  {
    const gatty2 = {...gatty, dir: DIR2};
    {
      await git.clone({dir: DIR2, url: URL});
      await gitReset({pfs: gatty2.pfs, git, dir: DIR2, ref: "HEAD~1", branch: 'master', hard: true});
      const globbed = await globby(DIR2 + '/**/*');
      const statuses =
          await Promise.all(globbed.map(s => s.slice(DIR2.length + 1))
                                .map(f => git.status({dir: DIR2, filepath: f}).then((s: string) => ({f, s}))));
      // delete leftover files (git reset won't delete them for us)
      await Promise.all(statuses.filter(g => g.s !== 'unmodified').map(g => gatty2.pfs.unlink(DIR2 + '/' + g.f)));
    }

    let events2 = 'ichi,ni,san'.split(',').map(s => s + '\n');
    let uids2 = events2.map(slug);
    const {newEvents, newSharedUid} = await writer(gatty2, last(uids), uids2, events2);
    const commits = await git.log({dir: DIR2, depth: 5000});
    const uniqueFiles = await promises.readdir(DIR2 + '/_uniques');
    const eventsList = await catEvents(gatty2);

    t.deepEqual(newEvents, ['chillin', 'cruisin', 'flying'], 'got correct remote events');
    t.equal(newSharedUid, last(uids2), 'updated up to last local unique');
    t.equal(commits.length, 4, 'now 4 commits');
    t.equal(uniqueFiles.length, events.length + events2.length + 3, 'all 9 events have uniques')
    t.equal(eventsList.trim().split('\n').length, 9, 'all 9 events available');

    rimraf.sync(DIR2);
  }

  // fresh new device, with events to commit, nothing in store
  {
    const gatty2 = {...gatty, dir: DIR2};
    {
      await git.clone({dir: DIR2, url: URL});
      // roll back to just README commit
      await gitReset({pfs: gatty2.pfs, git, dir: DIR2, ref: "HEAD~3", branch: 'master', hard: true});
      const globbed = await globby(DIR2 + '/**/*');
      const statuses =
          await Promise.all(globbed.map(s => s.slice(DIR2.length + 1))
                                .map(f => git.status({dir: DIR2, filepath: f}).then((s: string) => ({f, s}))));
      // delete leftover files (git reset won't delete them for us)
      await Promise.all(statuses.filter(g => g.s !== 'unmodified').map(g => gatty2.pfs.unlink(DIR2 + '/' + g.f)));
    }

    let events2 = 'never,give,up'.split(',').map(s => s + '\n');
    let uids2 = events2.map(slug);
    const {newEvents, newSharedUid} = await writer(gatty2, '', uids2, events2);
    const commits = await git.log({dir: DIR2, depth: 5000});
    const uniqueFiles = await promises.readdir(DIR2 + '/_uniques');
    const eventsList = await catEvents(gatty2);

    t.equal(newEvents.length, 9, '9 remote events retrieved');
    t.equal(newSharedUid, last(uids2), 'updated up to last local unique');
    t.equal(commits.length, 5, 'now 5 commits');
    t.equal(uniqueFiles.length, events.length + events2.length + 3 + 3, 'all 12 events have uniques')
    t.equal(eventsList.trim().split('\n').length, 12, 'all 12 events available');

    rimraf.sync(DIR2);
  }

  // Force rollback
  if (false) {
    let events2 = 'im,first'.split(',').map(s => s + '\n');
    let uids2 = events2.map(slug);

    let events3 = 'iwas,second'.split(',').map(s => s + '\n');
    let uids3 = events3.map(slug);

    const {newEvents: newEvents2, newSharedUid: newSharedUid2} = await writer(gatty, '', uids2, events2);

    const {newEvents: newEvents3, newSharedUid: newSharedUid3} = await writer(gatty, '', uids3, events3, 2, true);

    const commits = await git.log({dir: DIR, depth: 5000});
    const uniqueFiles = await promises.readdir(DIR + '/_uniques');
    const eventsList = await catEvents(gatty);

    // console.log({newEvents2, newSharedUid2, newEvents3, newSharedUid3, commits, uniqueFiles, eventsList});
  }

  SERVER.close();
  rimraf.sync(DIR);
  rimraf.sync(DIR2);
  rimraf.sync(REMOTEDIR);
  rimraf.sync(REMOTEDIR2);
  rimraf.sync(REMOTEDIR + '.git');

  t.end();
});

async function catEvents({pfs, dir}: Gatty) {
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
