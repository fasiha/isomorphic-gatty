"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const tape_1 = __importDefault(require("tape"));
const index_1 = require("./index");
const git = require('isomorphic-git');
const fs = require('fs');
const rimraf = require('rimraf');
const Server = require('node-git-server');
git.plugins.set('fs', fs);
function slug(s) { return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, ''); }
const events = 'hello!,hi there!,how are you?'.split(',').map(s => s + '\n');
const uids = events.map(slug);
const REMOTEDIR = 'github';
const REMOTEDIR2 = 'github2';
const DIR = 'whee';
const DIR2 = DIR + '2';
function multiLimit(t, eventFileSizeLimit = 900) {
    return __awaiter(this, void 0, void 0, function* () {
        directoryCleanup();
        const gatty = {
            pfs: fs_1.promises,
            dir: DIR,
            corsProxy: '',
            branch: '',
            depth: -1,
            since: new Date(),
            username: '',
            password: '',
            token: '',
            eventFileSizeLimit
        };
        // Initialize remote repo
        fs_1.mkdirSync(REMOTEDIR);
        git.init({ dir: REMOTEDIR });
        yield fs_1.promises.writeFile(`${REMOTEDIR}/README.md`, 'Welcome!');
        yield git.add({ dir: REMOTEDIR, filepath: 'README.md' });
        yield git.commit({ dir: REMOTEDIR, message: 'Initial', author: { name: 'Gatty', email: 'gatty@localhost' } });
        // create bare remote repo so we can (mock) push to it
        child_process_1.execSync(`git clone --bare ${REMOTEDIR} ${REMOTEDIR}.git`);
        // Start the mock git server
        const SERVER = new Server(__dirname);
        {
            const port = 8174;
            SERVER.on('push', (push) => { push.accept(); });
            SERVER.on('fetch', (fetch) => { fetch.accept(); });
            SERVER.listen(port, () => { console.log(`node-git-server running at http://localhost:${port}`); });
        }
        // execSync(`node_modules/.bin/git-http-mock-server start`);
        // This is the server URL
        const REMOTEURL = `http://localhost:8174/${REMOTEDIR}.git`;
        // clone a device
        yield git.clone({ dir: gatty.dir, url: REMOTEURL });
        // nothing to write, empty store
        {
            const { newEvents, newSharedUid } = yield index_1.writer(gatty, '', [], []);
            t.equal(newSharedUid, '');
            t.deepEqual(newEvents, [], 'empty store: no new events');
            const eventFiles = new Set(yield fs_1.promises.readdir(DIR + '/_events'));
            t.equal(eventFiles.size, 0, 'no files in event directory');
            const uniqueFiles = new Set(yield fs_1.promises.readdir(DIR + '/_uniques'));
            t.equal(uniqueFiles.size, 0, 'no files in unique directory');
            const commits = yield git.log({ dir: DIR, depth: 5000 });
            t.equal(commits.length, 1, 'only 1 commit, from remote');
        }
        // // Write new events to empty store
        {
            const { newEvents, newSharedUid } = yield index_1.writer(gatty, '', uids, events);
            t.equal(newSharedUid, uids[uids.length - 1], 'shared last event');
            t.deepEqual(newEvents, [], 'no new events');
            const eventFiles = new Set(yield fs_1.promises.readdir(DIR + '/_events'));
            const uniqueFiles = new Set(yield fs_1.promises.readdir(DIR + '/_uniques'));
            if (eventFileSizeLimit > 500) {
                t.equal(eventFiles.size, 1, 'only one event file on disk');
            }
            else {
                t.ok(eventFiles.size > 1, 'more than one event file');
            }
            t.ok(eventFiles.has('1'), 'expected event file found on dist');
            t.equal(uniqueFiles.size, uids.length, 'expected # of uniques on disk');
            uids.forEach(u => t.ok(uniqueFiles.has(`${u}`), 'unique file created'));
            const commits = yield git.log({ dir: DIR, depth: 5000 });
            t.equal(commits.length, 2, 'now 2 commits');
        }
        // No new events, just checking for remotes
        {
            const { newEvents, newSharedUid } = yield index_1.writer(gatty, last(uids), uids, events);
            // console.log({newEvents, newSharedUid});
            t.deepEqual(newEvents, [], 'no new events from remote');
            t.equal(newSharedUid, last(uids), 'idempotent even though we "added" them');
            const commits = yield git.log({ dir: DIR, depth: 5000 });
            t.equal(commits.length, 2, 'still 2 commits');
            const uniqueFiles = yield fs_1.promises.readdir(DIR + '/_uniques');
            t.equal(uniqueFiles.length, events.length);
        }
        // Append new events, no new events on remote
        {
            let events2 = 'chillin,cruisin,flying'.split(',').map(s => s + '\n');
            let uids2 = events2.map(slug);
            const { newEvents, newSharedUid } = yield index_1.writer(gatty, last(uids), uids2, events2);
            const commits = yield git.log({ dir: DIR, depth: 5000 });
            const uniqueFiles = yield fs_1.promises.readdir(DIR + '/_uniques');
            const eventsList = yield catEvents(gatty);
            t.deepEqual(newEvents, [], 'no new events from remote');
            t.equal(newSharedUid, last(uids2), 'last unique present');
            t.equal(commits.length, 3, 'now 3 commits');
            t.equal(uniqueFiles.length, events.length + events2.length, 'all events have uniques');
            t.equal(eventsList.trim().split('\n').length, events.length + events2.length, 'all events available');
        }
        // NEW device that has only partial store (the first 3 events from the first commit), with events of its own
        {
            const gatty2 = yield cloneAndRollback(gatty, REMOTEURL, 1);
            let events2 = 'ichi,ni,san'.split(',').map(s => s + '\n');
            let uids2 = events2.map(slug);
            const { newEvents, newSharedUid } = yield index_1.writer(gatty2, last(uids), uids2, events2);
            const commits = yield git.log({ dir: DIR2, depth: 5000 });
            const uniqueFiles = yield fs_1.promises.readdir(DIR2 + '/_uniques');
            const eventsList = yield catEvents(gatty2);
            t.deepEqual(newEvents, ['chillin', 'cruisin', 'flying'], 'got correct remote events');
            t.equal(newSharedUid, last(uids2), 'updated up to last local unique');
            t.equal(commits.length, 4, 'now 4 commits');
            t.equal(uniqueFiles.length, events.length + events2.length + 3, 'all 9 events have uniques');
            t.equal(eventsList.trim().split('\n').length, 9, 'all 9 events available');
            rimraf.sync(DIR2);
        }
        // fresh new device, with events to commit, nothing in store
        {
            const gatty2 = yield cloneAndRollback(gatty, REMOTEURL, 3);
            let events2 = 'never,give,up'.split(',').map(s => s + '\n');
            let uids2 = events2.map(slug);
            const { newEvents, newSharedUid } = yield index_1.writer(gatty2, '', uids2, events2);
            const eventsSet = new Set(newEvents);
            const commits = yield git.log({ dir: DIR2, depth: 5000 });
            const uniqueFiles = yield fs_1.promises.readdir(DIR2 + '/_uniques');
            const eventsList = yield catEvents(gatty2);
            t.equal(newEvents.length, 9, '9 remote events retrieved');
            t.equal(newSharedUid, last(uids2), 'updated up to last local unique');
            t.equal(commits.length, 5, 'now 5 commits');
            t.equal(uniqueFiles.length, events.length + events2.length + 3 + 3, 'all 12 events have uniques');
            t.equal(eventsList.trim().split('\n').length, 12, 'all 12 events available');
            for (const e of 'ichi,ni,san,chillin,cruisin,flying,hello!,hi there!,how are you?'.split(',')) {
                t.ok(eventsSet.has(e), e + ' present');
            }
            rimraf.sync(DIR2);
        }
        // Force rollback
        {
            const DIR3 = DIR + '3';
            rimraf.sync(DIR2);
            rimraf.sync(DIR3);
            yield git.clone({ dir: DIR2, url: REMOTEURL });
            yield git.clone({ dir: DIR3, url: REMOTEURL });
            const gatty2 = Object.assign({}, gatty, { dir: DIR2 });
            const gatty3 = Object.assign({}, gatty, { dir: DIR3 });
            let events2 = 'im,first'.split(',').map(s => s + '\n');
            let uids2 = events2.map(slug);
            let events3 = 'iwas,second,doh'.split(',').map(s => s + '\n');
            let uids3 = events3.map(slug);
            const { newEvents: newEvents2, newSharedUid: newSharedUid2 } = yield index_1.writer(gatty2, 'up', uids2, events2);
            // For device 3, skip the initial pull. This simulates the condition where device2 and device3 both pull+push at the
            // same time but the remote store gets device2's first, so device3's push will fail. This is a hyperfine edge case.
            const backup = git.pull;
            let pullSkipCount = 0;
            git.pull = (...args) => {
                t.comment('FAKE GIT PULL, SKIPPING, but replacing');
                pullSkipCount++;
                git.pull = backup;
            };
            const { newEvents: newEvents3, newSharedUid: newSharedUid3 } = yield index_1.writer(gatty3, 'up', uids3, events3);
            const commits = yield git.log({ dir: DIR3, depth: 5000 });
            const uniqueFiles = yield fs_1.promises.readdir(DIR3 + '/_uniques');
            const eventsList = yield catEvents(gatty3);
            t.equal(pullSkipCount, 1, 'we did skip a pull and caused a conflict');
            t.equal(commits.length, 7, 'device3 picked up all commits');
            // hello + chilling + ichi + never + im + doh = 3 + 3 + 3 + 3 + 2 + 3
            t.equal(uniqueFiles.length, events.length + 3 + 3 + 3 + 2 + 3, 'device3 got all uniques');
            t.equal(eventsList.trim().split('\n').length, events.length + 3 + 3 + 3 + 2 + 3, 'and all events');
            t.equal(newEvents2.length, 0, 'dev2 got nothing new');
            t.equal(newSharedUid2, last(uids2));
            t.equal(newEvents3.length, 2, 'dev3 got two remotes from dev2');
            t.equal(newSharedUid3, last(uids3));
            rimraf.sync(DIR2);
            rimraf.sync(DIR3);
        }
        SERVER.close();
        directoryCleanup();
    });
}
tape_1.default('intro', function (t) {
    return __awaiter(this, void 0, void 0, function* () {
        yield multiLimit(t, 900);
        t.end();
    });
});
tape_1.default('small size', function (t) {
    return __awaiter(this, void 0, void 0, function* () {
        yield multiLimit(t, 4);
        t.end();
    });
});
function catEvents({ pfs, dir }) {
    return __awaiter(this, void 0, void 0, function* () {
        const evDir = dir + '/_events';
        const files = yield fs_1.promises.readdir(evDir);
        const contents = yield Promise.all(files.map(file => fs_1.promises.readFile(evDir + '/' + file, 'utf8')));
        return contents.join('');
    });
}
// function sleep(ms: number) { return new Promise(resolve => {setTimeout(resolve, ms)}); }
function last(arr) {
    if ((arr.length - 1) in arr) {
        return arr[arr.length - 1];
    }
    throw new Error('out-of-bounds');
}
function cloneAndRollback(init, url, roll) {
    return __awaiter(this, void 0, void 0, function* () {
        const gatty2 = Object.assign({}, init, { dir: DIR2 });
        yield git.clone({ dir: DIR2, url });
        yield index_1.gitReset({ pfs: gatty2.pfs, git, dir: DIR2, ref: "HEAD~" + roll, branch: 'master', hard: true, cached: false });
        return gatty2;
    });
}
function directoryCleanup() {
    rimraf.sync(DIR);
    rimraf.sync(DIR2);
    rimraf.sync(REMOTEDIR);
    rimraf.sync(REMOTEDIR2);
    rimraf.sync(REMOTEDIR + '.git');
}
//# sourceMappingURL=test-node.js.map