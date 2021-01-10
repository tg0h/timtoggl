const argv = require('minimist')(process.argv.slice(2));
const VERBOSE = argv.v || process.env.VERBOSE //get from context?

let logger = {};
const highlight = require('cli-highlight').highlight;

logger.verboseLog = function verboseLog(entry, data) {
    if (VERBOSE) {
        if (typeof data == 'object'){
            let dataString = JSON.stringify(data, null, 4);
            console.log(highlight(dataString))
        }
        else {
            console.log(entry, data);
        }
    }
}

logger.verboseLogTime = function verboseLogTime(label, event) {
    if (VERBOSE) {
        if (event == 'start') {
            console.time(label)
        } else if (event == 'end') {
            console.timeEnd(label)
        }
    }
}

module.exports = logger
