/**
 * This function corrects the blockWindowSize.
 * If argument 1 === 0 then the size will be corrected to currentBlockHeight
 * If argument 1 !== 0 then the size will be corrected to argument 1
 **/

/** Define constants **/
const request = require('sync-request');
const fs = require('fs');
const wavesFunctions = require('./wavesFunctions');
const configfile = 'config.json'
const runfile = 'checkBlocks.run'
var args = process.argv.slice(2);

/** Read config file **/
if (fs.existsSync(configfile)) { //configurationfile is found, let's read contents and set variables
    var config = JSON.parse(fs.readFileSync(configfile));
    wavesFunctions.setQueryNode(config.paymentconfig.querynode_api);
} else {
    console.log("\n Error, configuration file '" + configfile + "' missing.\n"
        + " Please get a complete copy of the code from github. Will stop now.\n");
    return //exit program
}

if (args.length === 0) {
    console.info('No argument, nothing can be done');
    process.exit();
} else if (parseInt(args[0]) === 0) {
    console.info('Correct size');
    var currentHeight = wavesFunctions.getDataFromNode('/blocks/height').height;
    /** read start and endBlock **/
    if (fs.existsSync(config.toolbaseconfig.batchinfofile)) {
        var batchInfo = JSON.parse(fs.readFileSync(config.toolbaseconfig.batchinfofile));
        var startAtBlock = batchInfo.batchData.scanStartAtBlock;
    } else {
        process.exit();
    }
    config.paymentconfig.blockwindowsize = currentHeight - startAtBlock;
} else {
    config.paymentconfig.blockwindowsize = parseInt(args[0]);
}
fs.copyFile(configfile, configfile + '.bak', function (err) {
    if (err) {
        console.error(err);
    }
});

fs.writeFile(configfile, JSON.stringify(config, null, 4), {}, function(err) {
    if (err) {
        console.error(err);
    }
});
console.info('Size corrected to ' + config.paymentconfig.blockwindowsize);