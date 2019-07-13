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
const index_1 = require("./index");
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function test(url, username, token, corsProxy) {
    return __awaiter(this, void 0, void 0, function* () {
        let gatty = yield index_1.setup({ username, token, corsProxy }, url);
        for (let i = 0; i < 5; i++) {
            const d = new Date().toISOString();
            console.log(`### ${d} (${i})`);
            yield index_1.atomicAppend(gatty, 'foo', 'gatty Was here! ' + i + ' on ' + d + '\n', d, 'gatty', 'gatty');
            yield sleep(1000);
        }
        console.log('done');
    });
}
exports.test = test;
//# sourceMappingURL=test.js.map