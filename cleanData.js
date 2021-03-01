/**
 * This function checks the new blocks (after previous read-action) and store the relevant blocks in a file (blocks.json)
 * This file contains all forged blocks of this node and the generated fees
 **/

/** Define constants **/
const fs = require('fs');
const configfile = 'config.json'
const runfile = 'cleanData.run'
var args = process.argv.slice(2);
if (args.length == 1) {
    var dryRun = false;
} else {
    var dryRun = true;
    console.info('DryRun mode, nothing will be deleted');
}


/** Read config file **/
if (fs.existsSync(configfile)) { //configurationfile is found, let's read contents and set variables
    var config = JSON.parse(fs.readFileSync(configfile));
} else {
    console.log("\n Error, configuration file '" + configfile + "' missing.\n"
        + " Please get a complete copy of the code from github. Will stop now.\n");
    return //exit program
}

/** read start and endBlock **/
if (fs.existsSync(config.toolbaseconfig.batchinfofile)) {
    var batchInfo = JSON.parse(fs.readFileSync(config.toolbaseconfig.batchinfofile));
}

/** read current leases **/
if (fs.existsSync(config.toolbaseconfig.currentleasesfile)) {
    var leases = JSON.parse(fs.readFileSync(config.toolbaseconfig.currentleasesfile));
    fs.copyFile(config.toolbaseconfig.currentleasesfile, 'cleanUp_' + config.toolbaseconfig.currentleasesfile + '.bak', function (err) {
        if (err) {
            console.error(err);
        }
    });
} else {
    var leases = {};
}

/** read current blocks **/
if (fs.existsSync(config.toolbaseconfig.currentblocksfile)) {
    var blocks = JSON.parse(fs.readFileSync(config.toolbaseconfig.currentblocksfile));
    fs.copyFile(config.toolbaseconfig.currentblocksfile, 'cleanUp_' + config.toolbaseconfig.currentblocksfile + '.bak', function (err) {
        if (err) {
            console.error(err);
        }
    });
} else {
    var blocks = {};
}

/** clean already payed Blocks **/
var cleanBlocks = function() {
    var deleteBlock = true;
    for (height in blocks) {
        deleteBlock = true;
        for (type in batchInfo.batchData.batches) {
            batch = batchInfo.batchData.batches[type];
            if (batch.payedAtBlock < height) {
                deleteBlock = false;
            }
        }
        if (deleteBlock) {
            delete blocks[height];
        }
    }
}

/** Clean old leases **/
var cleanLeases = function() {
    var deleteLease = true;
    for (leaseId in leases) {
        deleteLease = true;
        lease = leases[leaseId];
        if (lease.cancelledAtBlock > batchInfo.batchData.batches.lessors.payedAtBlock) {
            deleteLease = false;
        }
        if (lease.cancelledAtBlock === -1) {
            deleteLease = false;
        }
        if (deleteLease) {
            delete leases[leaseId];
        }

    }
}

console.info('# Blocks', Object.keys(blocks).length);
cleanBlocks();
console.info('# Blocks', Object.keys(blocks).length);
console.info('# Leases', Object.keys(leases).length);
cleanLeases();
console.info('# Leases', Object.keys(leases).length);

if (!dryRun) {
    // Write current leases
    fs.writeFile(config.toolbaseconfig.currentleasesfile, JSON.stringify(leases), {}, function(err) {
        if (err) {
            console.error(err);
        } else {
            console.info("Leases written to file");
        }
    });

    // Write current blocks
    fs.writeFile(config.toolbaseconfig.currentblocksfile, JSON.stringify(blocks), {}, function(err) {
        if (err) {
            console.error(err);
        } else {
            console.info("Blocks written to file");
        }
    });
}
