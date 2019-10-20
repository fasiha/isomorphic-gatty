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
function setup({ dir = DEFAULT_DIR, corsProxy, branch, depth, since, username, password, token, eventFileSizeLimitBytes = 9216 } = {}, url, fs) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!fs) {
            fs = new LightningFS('fs', { wipe: true });
            git.plugins.set('fs', fs);
        }
        const pfs = fs.promises;
        yield pfs.mkdir(dir);
        yield git.clone({ url, dir, corsProxy, ref: branch, singleBranch: true, depth, since, username, password, token });
        return { url, dir, corsProxy, pfs, branch, depth, since, username, password, token, eventFileSizeLimitBytes };
    });
}
exports.setup = setup;
function readFile({ dir, pfs }, filepath) {
    return __awaiter(this, void 0, void 0, function* () {
        return pfs.readFile(`${dir}/${filepath}`, 'utf8');
    });
}
/**
 * Returns NEXT pointer, i.e., pointer to the END of the appended string
 */
function appendFile({ pfs, dir }, filepath, content) {
    return __awaiter(this, void 0, void 0, function* () {
        // console.log('## going to write to ' + dir + '/' + filepath);
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
// Thanks to jcubic: https://github.com/isomorphic-git/isomorphic-git/issues/729#issuecomment-489523944
function gitReset({ pfs, git, dir, ref, branch, hard = false, cached = true }) {
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
        // for non-cached mode, list files in staging area
        let before = [];
        if (!cached) {
            before = yield git.listFiles({ dir });
        }
        yield pfs.writeFile(`${dir}/.git/refs/heads/${branch}`, commit + '\n');
        if (!hard) {
            return;
        }
        // clear the index (if any)
        yield pfs.unlink(`${dir}/.git/index`);
        // checkout the branch into the working tree
        yield git.checkout({ dir, ref: branch });
        // delete any files if non-cached requested
        if (!cached) {
            const after = yield git.listFiles({ dir });
            if (before.length !== after.length) {
                const afterSet = new Set(after);
                return Promise.all(before.filter(f => !afterSet.has(f)).map(f => pfs.unlink(`${dir}/${f}`)));
            }
        }
    });
}
exports.gitReset = gitReset;
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
        const { eventFileSizeLimitBytes } = gatty;
        if (chars < eventFileSizeLimitBytes) {
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
        const SEPARATOR = '\n';
        if (lastSharedUid && !(yield fileExists(gatty, `${UNIQUES_DIR}/${lastSharedUid}`))) {
            throw new Error('lastSharedUid is in fact not shared ' + lastSharedUid);
        }
        // Write to store the unsync'd events
        let pointer = yield lastPointer(gatty);
        const endPointer = makePointer(pointer.relativeFile, pointer.chars);
        {
            let i = 0;
            for (const e of events) {
                pointer = yield addEvent(gatty, uids[i++], e + SEPARATOR, pointer);
            }
        }
        // get all events that others have pushed that we lack, from lastShareUid to endPointer
        const startPointer = lastSharedUid ? yield uniqueToPointer(gatty, lastSharedUid) : INIT_POINTER;
        const rawContents = yield pointerToPointer(gatty, startPointer, endPointer);
        const newEvents = rawContents ? rawContents.trim().split(SEPARATOR) : [];
        return { newEvents: lastSharedUid ? newEvents.slice(1) : newEvents };
    });
}
function sync(gatty, lastSharedUid, uids, events, maxRetries = 3) {
    return __awaiter(this, void 0, void 0, function* () {
        const { pfs, dir, username, password, token, url } = gatty;
        const message = `Gatty committing ${uids.length}-long entries on ` + (new Date()).toISOString();
        const name = 'Gatty';
        const email = 'gatty@localhost';
        let newEvents = [];
        for (let retry = 0; retry < maxRetries; retry++) {
            // pull remote (rewind if failed? or re-run setup with clean slate?)
            try {
                yield git.pull({ dir, singleBranch: true, fastForwardOnly: true, username, password, token });
            }
            catch (_a) {
                continue;
            }
            // edit and git add and get new events
            newEvents = [];
            newEvents = (yield writeNewEvents(gatty, lastSharedUid, uids, events)).newEvents;
            const staged = yield git.listFiles({ dir });
            const statuses = yield Promise.all(staged.map(file => git.status({ dir, filepath: file })));
            const changes = statuses.some(s => s !== 'unmodified');
            if (!changes) {
                return { newSharedUid: last(uids) || lastSharedUid, newEvents };
            }
            // commit
            yield git.commit({ dir, message, author: { name, email } });
            // push
            try {
                const pushed = yield git.push({ dir, url, username, password, token });
                // the above MIGHT not throw if, e.g., you try to push directories to GitHub Gist: pushed.errors will be truthy
                if (pushed && pushed.errors && pushed.errors.length) {
                    throw pushed;
                }
                return { newSharedUid: last(uids) || lastSharedUid, newEvents };
            }
            catch (pushed) {
                // if push failed, roll back commit and retry, up to some maximum
                const branch = (yield git.currentBranch({ dir })) || 'master';
                yield gitReset({ pfs, git, dir, ref: 'HEAD~1', branch, hard: true, cached: false });
            }
        }
        return { newSharedUid: lastSharedUid, newEvents };
    });
}
exports.sync = sync;
function inspect(gatty) {
    return __awaiter(this, void 0, void 0, function* () {
        const { pfs, dir } = gatty;
        function printDirContents(dir) {
            return __awaiter(this, void 0, void 0, function* () {
                if (dir.endsWith('/.git')) {
                    return;
                }
                const ls = yield pfs.readdir(dir);
                const stats = yield Promise.all(ls.map(f => pfs.lstat(dir + '/' + f)));
                const contents = [];
                for (let idx = 0; idx < ls.length; idx++) {
                    if (stats[idx].isDirectory()) {
                        yield printDirContents(dir + '/' + ls[idx]);
                        contents.push('(dir)');
                    }
                    else {
                        contents.push(yield pfs.readFile(dir + '/' + ls[idx], 'utf8'));
                    }
                }
                for (let idx = 0; idx < ls.length; idx++) {
                    console.log(`# ${dir}/${ls[idx]}
${contents[idx]}`);
                }
            });
        }
        yield printDirContents(dir);
    });
}
exports.inspect = inspect;
//# sourceMappingURL=index.js.map