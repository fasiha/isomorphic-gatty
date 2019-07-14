"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const LightningFS = require('@isomorphic-git/lightning-fs');
const git = require('isomorphic-git');
const DEFAULT_DIR = '/gitdir';
const DEFAULT_PROXY = 'https://cors.isomorphic-git.org';
function setup({ dir = DEFAULT_DIR, corsProxy = DEFAULT_PROXY, branch, depth, since, username, password, token, eventFileSizeLimit = 900 } = {}, url, fs) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!fs) {
            const fs = new LightningFS('fs', { wipe: true });
            git.plugins.set('fs', fs);
        }
        const pfs = fs.promises;
        yield pfs.mkdir(dir);
        yield git.clone({ url, dir, corsProxy, ref: branch, singleBranch: true, depth, since, username, password, token });
        return { dir, corsProxy, pfs, branch, depth, since, username, password, token, eventFileSizeLimit };
    });
}
exports.setup = setup;
function push({ dir, username, password, token }) {
    return __awaiter(this, void 0, void 0, function* () {
        let pushres = yield git.push({ dir, username, password, token });
        return pushres.errors;
    });
}
exports.push = push;
function ls({ dir, pfs }, filepath = '') {
    return __awaiter(this, void 0, void 0, function* () {
        return pfs.readdir(filepath ? `${dir}/${filepath}`.replace(/\/+$/, '') : dir);
    });
}
exports.ls = ls;
function readFile({ dir, pfs }, filepath) {
    return __awaiter(this, void 0, void 0, function* () {
        return pfs.readFile(`${dir}/${filepath}`, 'utf8');
    });
}
exports.readFile = readFile;
function writeFileCommit({ pfs, dir }, filepath, contents, message, name = 'Me', email = 'mrtest@example.com') {
    return __awaiter(this, void 0, void 0, function* () {
        yield pfs.writeFile(`${dir}/${filepath}`, contents, 'utf8');
        yield git.add({ dir, filepath });
        return git.commit({ dir, message, author: { name, email } });
    });
}
exports.writeFileCommit = writeFileCommit;
/**
 * Returns NEXT pointer, i.e., pointer to the END of the appended string
 */
function appendFile({ pfs, dir }, filepath, content) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('## going to write to ' + dir + '/' + filepath);
        let oldContents = '';
        const fullpath = `${dir}/${filepath}`;
        try {
            oldContents = yield pfs.readFile(fullpath, 'utf8');
        }
        catch (e) {
            // `readFile` will throw if file not found. Moving along.
        }
        yield pfs.writeFile(fullpath, oldContents + content, 'utf8');
        yield git.add({ dir, filepath });
        return makePointer(filepath, oldContents.length + content.length);
    });
}
function atomicAppend(gatty, filepath, content, message, name, email, maxRetries = 3) {
    return __awaiter(this, void 0, void 0, function* () {
        const { pfs, dir, username, password, token } = gatty;
        for (let retry = 0; retry < maxRetries; retry++) {
            // pull remote (rewind if failed?)
            yield git.pull({ dir, singleBranch: true, fastForwardOnly: true, username, password, token });
            // write/append
            yield appendFile(gatty, filepath, content);
            // add & commit
            yield git.add({ dir, filepath });
            yield git.commit({ dir, message, author: { name, email } });
            // push
            const pushed = yield git.push({ dir, username, password, token });
            if (pushed.errors) {
                // if push failed, roll back commit and retry, up to some maximum
                const branch = (yield git.currentBranch({ dir })) || 'master';
                yield gitReset({ pfs, git, dir, ref: 'HEAD~1', branch, hard: true });
            }
            else {
                return;
            }
        }
        throw new Error('failed to commit');
    });
}
exports.atomicAppend = atomicAppend;
// Thanks to jcubic: https://github.com/isomorphic-git/isomorphic-git/issues/729#issuecomment-489523944
function gitReset({ pfs, git, dir, ref, branch, hard = false }) {
    return __awaiter(this, void 0, void 0, function* () {
        const re = /^HEAD~([0-9]+)$/;
        const m = ref.match(re);
        if (!m) {
            throw new Error(`Wrong ref ${ref}`);
        }
        const count = +m[1];
        const commits = yield git.log({ dir, depth: count + 1 });
        if (commits.length < count + 1) {
            throw new Error('Not enough commits');
        }
        const commit = commits[commits.length - 1].oid;
        yield pfs.writeFile(`${dir}/.git/refs/heads/${branch}`, commit + '\n');
        if (!hard) {
            return;
        }
        // clear the index (if any)
        yield pfs.unlink(`${dir}/.git/index`);
        // checkout the branch into the working tree
        return git.checkout({ dir, ref: branch });
    });
}
function fileExists({ pfs, dir }, filepath) {
    return __awaiter(this, void 0, void 0, function* () {
        const fullpath = `${dir}/${filepath}`;
        try {
            const res = yield pfs.stat(fullpath);
            return !res.isDirectory();
        }
        catch (e) {
            return false;
        }
    });
}
const UNIQUES_DIR = '_uniques';
const EVENTS_DIR = '_events';
const POINTER_SEP = '-';
const BASE = 36;
function last(arr) { return arr[arr.length - 1]; }
function makePointer(relativeFile, chars) { return { relativeFile, chars }; }
function lastPointer({ pfs, dir }) {
    return __awaiter(this, void 0, void 0, function* () {
        const lastFile = last(yield pfs.readdir(`${dir}/${EVENTS_DIR}`));
        if (!lastFile) {
            return makePointer('', 0);
        }
        const filecontents = yield pfs.readFile(`${dir}/${EVENTS_DIR}/${lastFile}`, 'utf8');
        // Cannot replace readFile (expensive) with stat because stat's size is true bytes while we need UTF-16 chars
        return makePointer(`${EVENTS_DIR}/${lastFile}`, filecontents.length);
    });
}
/**
 * Returns output of `appendFile` on event, i.e., pointer to the END of the saved payload
 */
function addEvent(gatty, uid, payload, pointer = {}) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!('relativeFile' in pointer && 'chars' in pointer && pointer.relativeFile)) {
            const { relativeFile, chars } = yield lastPointer(gatty);
            pointer.relativeFile = relativeFile || `${EVENTS_DIR}/1`;
            pointer.chars = chars;
        }
        const { relativeFile, chars } = pointer;
        const uniqueFile = `${UNIQUES_DIR}/${uid}`;
        if (yield fileExists(gatty, uniqueFile)) {
            return makePointer(relativeFile, chars);
        }
        const { eventFileSizeLimit } = gatty;
        if (chars < eventFileSizeLimit) {
            // Unique file should contain pointer to BEGINNING of payload
            yield appendFile(gatty, uniqueFile, `${relativeFile}${POINTER_SEP}${chars.toString(BASE)}`);
            return appendFile(gatty, relativeFile, payload);
        }
        const lastFilename = last(relativeFile.split('/')) || '1';
        const parsed = parseInt(lastFilename, BASE);
        if (isNaN(parsed)) {
            throw new Error('non-numeric filename');
        }
        const newFile = EVENTS_DIR + '/' + (parsed + 1).toString(BASE);
        // Unique file should contain pointer to BEGINNING of payload
        yield appendFile(gatty, uniqueFile, `${newFile}${POINTER_SEP}0`);
        return appendFile(gatty, newFile, payload);
    });
}
/**
 * Pointer to BEGINNING of the unique ID's payload
 */
function uniqueToPointer(gatty, unique) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!unique) {
            return makePointer('', 0);
        }
        const pointerStr = yield readFile(gatty, `${UNIQUES_DIR}/${unique}`);
        const [file, offset] = pointerStr.split(POINTER_SEP);
        if (!file || !offset) {
            throw new Error('failed to parse unique ' + unique);
        }
        return makePointer(file, parseInt(offset, BASE));
    });
}
function pointerToPointer(gatty, start, end) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!start.relativeFile || !end.relativeFile) {
            return '';
        }
        // if all in a single file, slurp it, slice off either edge, and return
        if (start.relativeFile === end.relativeFile) {
            return (yield readFile(gatty, start.relativeFile)).slice(start.chars, end.chars);
        }
        // if *multiple* files, slurp each of them in order. The first and last should be trimmed.
        const fileInts = [start, end].map(({ relativeFile }) => parseInt(relativeFile.slice(EVENTS_DIR.length + 1), BASE));
        let contents = '';
        for (let i = fileInts[0]; i <= fileInts[1]; i++) {
            const all = yield readFile(gatty, EVENTS_DIR + '/' + i.toString(BASE));
            if (i === fileInts[0]) {
                contents += all.slice(start.chars);
            }
            else if (i === fileInts[1]) {
                contents += all.slice(0, end.chars);
            }
            else {
                contents += all;
            }
        }
        return contents;
    });
}
function mkdirp({ dir, pfs }) {
    return __awaiter(this, void 0, void 0, function* () {
        for (const path of [dir, `${dir}/${EVENTS_DIR}`, `${dir}/${UNIQUES_DIR}`]) {
            try {
                yield pfs.mkdir(path);
            }
            catch (_a) { }
        }
    });
}
function writeNewEvents(gatty, lastSharedUid, uids, events) {
    return __awaiter(this, void 0, void 0, function* () {
        yield mkdirp(gatty);
        const INIT_POINTER = makePointer(`${EVENTS_DIR}/1`, 0);
        if (lastSharedUid && !(yield fileExists(gatty, `${UNIQUES_DIR}/${lastSharedUid}`))) {
            throw new Error('lastSharedUid is in fact not shared ' + lastSharedUid);
        }
        // Write to store the unsync'd events
        let pointer = yield lastPointer(gatty);
        const endPointer = makePointer(pointer.relativeFile, pointer.chars);
        {
            let i = 0;
            for (const e of events) {
                pointer = yield addEvent(gatty, uids[i++], e, pointer);
            }
        }
        // get all events that others have pushed that we lack, from lastShareUid to endPointer
        const startPointer = lastSharedUid ? yield uniqueToPointer(gatty, lastSharedUid) : INIT_POINTER;
        const rawContents = yield pointerToPointer(gatty, startPointer, endPointer);
        const newEvents = rawContents ? rawContents.trim().split('\n') : [];
        return { newEvents: lastSharedUid ? newEvents.slice(1) : newEvents };
    });
}
function writer(gatty, lastSharedUid, uids, events, maxRetries = 3) {
    return __awaiter(this, void 0, void 0, function* () {
        const { pfs, dir, username, password, token } = gatty;
        const message = `Gatty committing ${uids.length}-long entries on ` + (new Date()).toISOString();
        const name = 'Gatty';
        const email = 'gatty@localhost';
        let newEvents = [];
        for (let retry = 0; retry < maxRetries; retry++) {
            // pull remote (rewind if failed? or re-run setup with clean slate?)
            yield git.pull({ dir, singleBranch: true, fastForwardOnly: true, username, password, token });
            // edit and git add and get new events
            newEvents = [];
            newEvents = (yield writeNewEvents(gatty, lastSharedUid, uids, events)).newEvents;
            // commit
            yield git.commit({ dir, message, author: { name, email } });
            // push
            const pushed = yield git.push({ dir, username, password, token });
            if (pushed.errors && pushed.errors.length) {
                // if push failed, roll back commit and retry, up to some maximum
                const branch = (yield git.currentBranch({ dir })) || 'master';
                yield gitReset({ pfs, git, dir, ref: 'HEAD~1', branch, hard: true });
            }
            else {
                return { newSharedUid: last(uids) || '', newEvents };
            }
        }
        return { newSharedUid: lastSharedUid, newEvents };
    });
}
exports.writer = writer;
// if (module === require.main) {
//   let {promises} = require('fs');
//   (async function() {
//     const gatty: Gatty = {
//       pfs: promises,
//       dir: 'whee',
//       corsProxy: '',
//       branch: '',
//       depth: -1,
//       since: new Date(),
//       username: '',
//       password: '',
//       token: '',
//       eventFileSizeLimit: 900
//     };
//     function slug(s: string) { return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, '') }
//     const events = 'hello!,hi there!,how are you?'.split(',').map(s => s + '\n');
//     const uids = events.map(slug);
//     {
//       console.log('## INITIAL WRITE ON EMPTY STORE');
//       const {newEvents, filesTouched} = await writeNewEvents(gatty, '', uids, events);
//       console.log('filesTouched', filesTouched);
//       console.log('newEvents', newEvents)
//     }
//     {
//       console.log('## CHECKING FOR NEW REMOTES');
//       const {newEvents, filesTouched} = await writeNewEvents(gatty, last(uids) || '', uids, events);
//       console.log('filesTouched', filesTouched);
//       console.log('newEvents', newEvents)
//     }
//     {
//       console.log('## APPENDING NEW EVENTS FROM BEFORE');
//       let events2 = 'chillin,cruisin,flying'.split(',').map(s => s + '\n');
//       let uids2 = events2.map(slug);
//       const {newEvents, filesTouched} = await writeNewEvents(gatty, uids[uids.length - 1], uids2, events2);
//       console.log('filesTouched', filesTouched);
//       console.log('newEvents', newEvents)
//     }
//     {
//       console.log('## NEW DEVICE THAT ONLY HAS PARTIAL STORE (first commit, hello etc.)');
//       let events2 = 'ichi,ni,san'.split(',').map(s => s + '\n');
//       let uids2 = events2.map(slug);
//       const {newEvents, filesTouched} = await writeNewEvents(gatty, uids[uids.length - 1], uids2, events2);
//       console.log('filesTouched', filesTouched);
//       console.log('newEvents', newEvents)
//     }
//     {
//       console.log('## FRESH DEVICE, with events to commit, nothing in store');
//       let events2 = 'never,giv,up'.split(',').map(s => s + '\n');
//       let uids2 = events2.map(slug);
//       const {newEvents, filesTouched} = await writeNewEvents(gatty, '', uids2, events2);
//       console.log('filesTouched', filesTouched);
//       console.log('newEvents', newEvents)
//     }
//     console.log('done');
//   })();
// }
//# sourceMappingURL=index.js.map