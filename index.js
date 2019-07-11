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
function setup({ dir, corsProxy, branch, depth, since, username, password, token } = {}, url) {
    return __awaiter(this, void 0, void 0, function* () {
        dir = dir || DEFAULT_DIR;
        corsProxy = corsProxy || DEFAULT_PROXY;
        const fs = new LightningFS('fs', { wipe: true });
        const pfs = fs.promises;
        git.plugins.set('fs', fs);
        yield pfs.mkdir(dir);
        yield git.clone({ url, dir, corsProxy, ref: branch, singleBranch: true, depth, since, username, password, token });
        return { dir, corsProxy, pfs, branch, depth, since, username, password, token };
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
function atomicAppend({ pfs, dir, username, password, token }, filepath, content, message, name, email, maxRetries = 3) {
    return __awaiter(this, void 0, void 0, function* () {
        for (let retry = 0; retry < maxRetries; retry++) {
            // pull remote (rewind if failed?)
            yield git.pull({ dir, singleBranch: true, fastForwardOnly: true, username, password, token });
            // write/append
            let oldContents = '';
            const fullpath = `${dir}/${filepath}`;
            try {
                oldContents = yield pfs.readFile(fullpath, 'utf8');
            }
            catch (e) {
                // `readFile` will throw if file not found. Moving along.
            }
            yield pfs.writeFile(fullpath, oldContents + content, 'utf8');
            // add & commit
            yield git.add({ dir, filepath });
            yield git.commit({ dir, message, author: { name, email } });
            // push
            const pushed = yield git.push({ dir, username, password, token });
            if (pushed.errors) {
                // if push failed, roll back commit and retry, up to some maximum
                const branch = yield git.currentBranch({ dir });
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
