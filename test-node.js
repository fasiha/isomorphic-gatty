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
const globby_1 = __importDefault(require("globby"));
const tape_1 = __importDefault(require("tape"));
const index_1 = require("./index");
const git = require('isomorphic-git');
const fs = require('fs');
const rimraf = require('rimraf');
git.plugins.set('fs', fs);
function slug(s) { return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, ''); }
const events = 'hello!,hi there!,how are you?'.split(',').map(s => s + '\n');
const uids = events.map(slug);
const REMOTEDIR = 'github';
const DIR = 'whee';
tape_1.default('intro', function intro(t) {
    return __awaiter(this, void 0, void 0, function* () {
        // delete old git dirs
        rimraf.sync(DIR);
        rimraf.sync(REMOTEDIR);
        rimraf.sync(REMOTEDIR + '.git');
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
            eventFileSizeLimit: 900
        };
        fs_1.mkdirSync(REMOTEDIR);
        git.init({ dir: REMOTEDIR });
        yield fs_1.promises.writeFile(`${REMOTEDIR}/README.md`, 'Welcome!');
        yield git.add({ dir: REMOTEDIR, filepath: 'README.md' });
        yield git.commit({ dir: REMOTEDIR, message: 'Initial', author: { name: 'Gatty', email: 'gatty@localhost' } });
        child_process_1.execSync(`git clone --bare ${REMOTEDIR} ${REMOTEDIR}.git`);
        child_process_1.execSync(`node_modules/.bin/git-http-mock-server start`);
        yield git.clone({ dir: gatty.dir, url: `http://localhost:8174/${REMOTEDIR}.git` });
        yield git.pull({ dir: gatty.dir });
        // nothing to write, empty store
        {
            const { newEvents, newSharedUid } = yield index_1.writer(gatty, '', [], []);
            t.equal(newSharedUid, '');
            t.deepEqual(newEvents, [], 'empty store: no new events');
            const eventFiles = new Set(yield fs_1.promises.readdir(DIR + '/_events'));
            t.equal(eventFiles.size, 0, 'no files in event directory');
            const uniqueFiles = new Set(yield fs_1.promises.readdir(DIR + '/_uniques'));
            t.equal(uniqueFiles.size, 0, 'no files in unique directory');
            console.log(DIR, yield globby_1.default(`${DIR}/**/*`));
        }
        // // Write new events to empty store
        {
            const { newEvents, newSharedUid } = yield index_1.writer(gatty, '', uids, events);
            console.log({ newEvents, newSharedUid });
            t.deepEqual(newEvents, [], 'no new events');
            const eventFiles = new Set(yield fs_1.promises.readdir(DIR + '/_events'));
            const uniqueFiles = new Set(yield fs_1.promises.readdir(DIR + '/_uniques'));
            t.equal(eventFiles.size, 1, 'only one event file on disk');
            t.ok(eventFiles.has('1'), 'expected event file found on dist');
            t.equal(uniqueFiles.size, uids.length, 'expected # of uniques on disk');
            uids.forEach(u => t.ok(uniqueFiles.has(`${u}`), 'unique file created'));
        }
        // // No new events, just checking for remotes
        // {
        //   const {newEvents} = await writeNewEvents(gatty, uids[uids.length - 1], uids, events);
        //   console.log({newEvents});
        // }
        child_process_1.execSync(`node_modules/.bin/git-http-mock-server stop`);
        rimraf.sync(DIR);
        rimraf.sync(REMOTEDIR);
        rimraf.sync(REMOTEDIR + '.git');
        t.end();
    });
});
function sleep(ms) { return new Promise(resolve => { setTimeout(resolve, ms); }); }
//# sourceMappingURL=test-node.js.map