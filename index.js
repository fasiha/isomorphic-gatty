"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var LightningFS = require('@isomorphic-git/lightning-fs');
var git = require('isomorphic-git');
var DEFAULT_DIR = '/gitdir';
var DEFAULT_PROXY = 'https://cors.isomorphic-git.org';
function setup(_a, url) {
    var _b = _a === void 0 ? {} : _a, dir = _b.dir, corsProxy = _b.corsProxy, branch = _b.branch, depth = _b.depth, since = _b.since, username = _b.username, password = _b.password, token = _b.token;
    return __awaiter(this, void 0, void 0, function () {
        var fs, pfs;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    dir = dir || DEFAULT_DIR;
                    corsProxy = corsProxy || DEFAULT_PROXY;
                    fs = new LightningFS('fs', { wipe: true });
                    pfs = fs.promises;
                    git.plugins.set('fs', fs);
                    return [4 /*yield*/, pfs.mkdir(dir)];
                case 1:
                    _c.sent();
                    return [4 /*yield*/, git.clone({ url: url, dir: dir, corsProxy: corsProxy, ref: branch, singleBranch: true, depth: depth, since: since, username: username, password: password, token: token })];
                case 2:
                    _c.sent();
                    return [2 /*return*/, { dir: dir, corsProxy: corsProxy, pfs: pfs, branch: branch, depth: depth, since: since, username: username, password: password, token: token }];
            }
        });
    });
}
exports.setup = setup;
function push(_a) {
    var dir = _a.dir, username = _a.username, password = _a.password, token = _a.token;
    return __awaiter(this, void 0, void 0, function () {
        var pushres;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, git.push({ dir: dir, username: username, password: password, token: token })];
                case 1:
                    pushres = _b.sent();
                    return [2 /*return*/, pushres.errors];
            }
        });
    });
}
exports.push = push;
function ls(_a, filepath) {
    var dir = _a.dir, pfs = _a.pfs;
    if (filepath === void 0) { filepath = ''; }
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_b) {
            return [2 /*return*/, pfs.readdir(filepath ? (dir + "/" + filepath).replace(/\/+$/, '') : dir)];
        });
    });
}
exports.ls = ls;
function readFile(_a, filepath) {
    var dir = _a.dir, pfs = _a.pfs;
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_b) {
            return [2 /*return*/, pfs.readFile(dir + "/" + filepath, 'utf8')];
        });
    });
}
exports.readFile = readFile;
function writeFileCommit(_a, filepath, contents, message, name, email) {
    var pfs = _a.pfs, dir = _a.dir;
    if (name === void 0) { name = 'Me'; }
    if (email === void 0) { email = 'mrtest@example.com'; }
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, pfs.writeFile(dir + "/" + filepath, contents, 'utf8')];
                case 1:
                    _b.sent();
                    return [4 /*yield*/, git.add({ dir: dir, filepath: filepath })];
                case 2:
                    _b.sent();
                    return [2 /*return*/, git.commit({ dir: dir, message: message, author: { name: name, email: email } })];
            }
        });
    });
}
exports.writeFileCommit = writeFileCommit;
function atomicAppend(_a, filepath, content, message, name, email, maxRetries) {
    var pfs = _a.pfs, dir = _a.dir, username = _a.username, password = _a.password, token = _a.token;
    if (maxRetries === void 0) { maxRetries = 3; }
    return __awaiter(this, void 0, void 0, function () {
        var retry, oldContents, fullpath, e_1, pushed, branch;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    retry = 0;
                    _b.label = 1;
                case 1:
                    if (!(retry < maxRetries)) return [3 /*break*/, 15];
                    // pull remote (rewind if failed?)
                    return [4 /*yield*/, git.pull({ dir: dir, singleBranch: true, fastForwardOnly: true, username: username, password: password, token: token })];
                case 2:
                    // pull remote (rewind if failed?)
                    _b.sent();
                    oldContents = '';
                    fullpath = dir + "/" + filepath;
                    _b.label = 3;
                case 3:
                    _b.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, pfs.readFile(fullpath, 'utf8')];
                case 4:
                    oldContents = _b.sent();
                    return [3 /*break*/, 6];
                case 5:
                    e_1 = _b.sent();
                    return [3 /*break*/, 6];
                case 6: return [4 /*yield*/, pfs.writeFile(fullpath, oldContents + content, 'utf8')];
                case 7:
                    _b.sent();
                    // add & commit
                    return [4 /*yield*/, git.add({ dir: dir, filepath: filepath })];
                case 8:
                    // add & commit
                    _b.sent();
                    return [4 /*yield*/, git.commit({ dir: dir, message: message, author: { name: name, email: email } })];
                case 9:
                    _b.sent();
                    return [4 /*yield*/, git.push({ dir: dir, username: username, password: password, token: token })];
                case 10:
                    pushed = _b.sent();
                    if (!pushed.errors) return [3 /*break*/, 13];
                    return [4 /*yield*/, git.currentBranch({ dir: dir })];
                case 11:
                    branch = _b.sent();
                    return [4 /*yield*/, gitReset({ pfs: pfs, git: git, dir: dir, ref: 'HEAD~1', branch: branch, hard: true })];
                case 12:
                    _b.sent();
                    return [3 /*break*/, 14];
                case 13: return [2 /*return*/];
                case 14:
                    retry++;
                    return [3 /*break*/, 1];
                case 15: throw new Error('failed to commit');
            }
        });
    });
}
exports.atomicAppend = atomicAppend;
// Thanks to jcubic: https://github.com/isomorphic-git/isomorphic-git/issues/729#issuecomment-489523944
function gitReset(_a) {
    var pfs = _a.pfs, git = _a.git, dir = _a.dir, ref = _a.ref, branch = _a.branch, _b = _a.hard, hard = _b === void 0 ? false : _b;
    return __awaiter(this, void 0, void 0, function () {
        var re, m, count, commits, commit;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    re = /^HEAD~([0-9]+)$/;
                    m = ref.match(re);
                    if (!m) {
                        throw new Error("Wrong ref " + ref);
                    }
                    count = +m[1];
                    return [4 /*yield*/, git.log({ dir: dir, depth: count + 1 })];
                case 1:
                    commits = _c.sent();
                    if (commits.length < count + 1) {
                        throw new Error('Not enough commits');
                    }
                    commit = commits[commits.length - 1].oid;
                    return [4 /*yield*/, pfs.writeFile(dir + "/.git/refs/heads/" + branch, commit + '\n')];
                case 2:
                    _c.sent();
                    if (!hard) {
                        return [2 /*return*/];
                    }
                    // clear the index (if any)
                    return [4 /*yield*/, pfs.unlink(dir + "/.git/index")];
                case 3:
                    // clear the index (if any)
                    _c.sent();
                    // checkout the branch into the working tree
                    return [2 /*return*/, git.checkout({ dir: dir, ref: branch })];
            }
        });
    });
}
