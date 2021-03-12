/**
 * This function checks the new blocks (after previous read-action) and store the relevant blocks in a file (blocks.json)
 * This file contains all forged blocks of this node and the generated fees
 **/

/** Define constants **/
const request = require('sync-request');
const fs = require('fs');
const wavesFunctions = require('./wavesFunctions');
const configfile = 'config.json'
const runfile = 'checkBlocks.run'

/** blocks structure **/
var block = function(height, rewards, fees) {
    const obj = {};
    obj.height = height;
    obj.rewards = rewards;
    obj.fees = fees;
    obj.payoutFile = 0;
    return obj;
}

/** lease structure **/
var lease = function(address, amount, startedAtBlock, cancelledAtBlock, transactionId) {
    const obj = {};
    obj.address = address;
    obj.amount = amount;
    obj.startedAtBlock = startedAtBlock;
    obj.cancelledAtBlock = cancelledAtBlock;
    obj.transactionId = transactionId;
    return obj;
}

/** Read config file **/
if (fs.existsSync(configfile)) { //configurationfile is found, let's read contents and set variables
    var config = JSON.parse(fs.readFileSync(configfile));
    wavesFunctions.setQueryNode(config.paymentconfig.querynode_api);
} else {
    console.log("\n Error, configuration file '" + configfile + "' missing.\n"
        + " Please get a complete copy of the code from github. Will stop now.\n");
    return //exit program
}

/** read start and endBlock **/
if (fs.existsSync(config.toolbaseconfig.batchinfofile)) {
    var batchInfo = JSON.parse(fs.readFileSync(config.toolbaseconfig.batchinfofile));
    var startAtBlock = batchInfo.batchData.scanStartAtBlock;
    fs.copyFile(config.toolbaseconfig.batchinfofile, startAtBlock + '_' + config.toolbaseconfig.batchinfofile + '.bak', function (err) {
        if (err) {
            console.error(err);
        }
    });
} else {
    var startAtBlock = config.paymentconfig.firstleaserblock;
    batchInfo = {};
    batchInfo.batchData = {};
    batchInfo.batchData.batches = {};
    batchInfo.batchData.batches.lessors = {id: 1, startedAtBlock: startAtBlock, payedAtBlock: 0};
    config.paymentconfig.assetHoldersPayments.forEach(function (assetHoldersPayment) {
        batchInfo.batchData.batches[assetHoldersPayment.id] = {id: 1, startedAtBlock: startAtBlock, payedAtBlock: 0};
    });
}
var endAtBlock = startAtBlock + config.paymentconfig.blockwindowsize;

/** read current leases **/
if (fs.existsSync(config.toolbaseconfig.currentleasesfile)) {
    var leases = JSON.parse(fs.readFileSync(config.toolbaseconfig.currentleasesfile));
    fs.copyFile(config.toolbaseconfig.currentleasesfile, startAtBlock + '_' + config.toolbaseconfig.currentleasesfile + '.bak', function (err) {
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
    fs.copyFile(config.toolbaseconfig.currentblocksfile, startAtBlock + '_' + config.toolbaseconfig.currentblocksfile + '.bak', function (err) {
        if (err) {
            console.error(err);
        }
    });
} else {
    var blocks = {};
}

/** read existing incentivePayouts **/
if (fs.existsSync(config.toolbaseconfig.incentivePayoutsFile)) {
    var incentivePayouts = JSON.parse(fs.readFileSync(config.toolbaseconfig.incentivePayoutsFile));
    fs.copyFile(config.toolbaseconfig.incentivePayoutsFile, startAtBlock + '_' + config.toolbaseconfig.incentivePayoutsFile + '.bak', function (err) {
        if (err) {
            console.error(err);
        }
    });
} else {
    var incentivePayouts = {};
}

/** set assetInfo **/
var assetInfo = {};

/**
 * Method that returns all aliases for address.
 *
 * @returns {Array} all aliases for address
 */
var getAllAlias = function () {

    var Aliases = wavesFunctions.getDataFromNode('/alias/by-address/' + config.paymentconfig.leasewallet);
    Aliases.forEach(function (alias) {
        console.log(alias);
    });
    return Aliases;
}

/** Start function **/
var start = function() {
    // Check if function did not crash at last run
    if (fs.existsSync(runfile)) {
        console.log("\nALERT:\n" +
            "Found appng interruptionfile. Apparently appng was interupted abnormally last time!\n" +
            "Normally if collector sessions run 100% fine, this alert should not be given.\n" +
            "Check your logs and if everything is fine, delete the crashfile: '" + runfile + "'\n" +
            "\nGoodbye now!\n")
        return; //Terminate
    } else {
        fs.closeSync(fs.openSync(runfile, 'w'));
    }

    // check if last block is lower then endAtBlock (and get 100 blocks margin)
    let lastBlockHeight = wavesFunctions.getDataFromNode('/blocks/height').height;
    if (lastBlockHeight < endAtBlock + 100) {
        console.info('Last block to read is in the future, current heigt is ' + lastBlockHeight + ' wanted height is ' + (endAtBlock + 100));
        var blockDiff = endAtBlock + 100 - lastBlockHeight;
        var days = Math.floor(blockDiff / (24 * 60));
        var hours = Math.floor((blockDiff - (days * 24 * 60)) / 60);
        var minutes = Math.floor((blockDiff - (days * 24 * 60)) - (hours * 60));
        var backIn = '~ ' + days + ' days, ' + hours + ' hours and ' + minutes + ' minutes. GoodBye';
        console.info('Come back in ' + backIn);
        stop();
    }
    var blockChainBlocks = [];
    var aliases = getAllAlias();

    var currentEndblock = endAtBlock;
    var currentStartBlock = startAtBlock;
    var myBlock = false;
    var blockFee = 0;
    // Read the blocks
    while (currentStartBlock < endAtBlock) {
        currentEndblock = currentStartBlock + 99;
        if (currentEndblock > endAtBlock) {
            currentEndblock = endAtBlock;
        }
        console.log("Gettings blocks from " + currentStartBlock + " till " + currentEndblock);
        blockChainBlocks = wavesFunctions.getDataFromNode('/blocks/seq/' + currentStartBlock + '/' + currentEndblock);
        // Scan each block
        blockChainBlocks.forEach(function (blockChainBlock, index) {
            myBlock = false;
            // check if it is forged by this node
            if (blockChainBlock.generator === config.paymentconfig.leasewallet && index !== 0) {
                newBlock = block(blockChainBlock.height, blockChainBlock.reward, 0);
                myBlock = true;
                blockFee = 0;
            }
            // Scan each transaction
            blockChainBlock.transactions.forEach(function(transaction) {
                // check if there is a new lease in it
                if (transaction.type === 8 && (transaction.recipient === config.paymentconfig.leasewallet || (aliases.indexOf(transaction.recipient) > -1))) {
                    leases[transaction.id] = lease(transaction.sender, transaction.amount, blockChainBlock.height, -1, transaction.id);
                    if (config.paymentconfig.incentiveAssets.length > 0) {
                        if (!(transaction.sender in incentivePayouts)) {
                            incentivePayouts[transaction.sender] = {};
                        }
                        config.paymentconfig.incentiveAssets.forEach(function(asset) {
                            if (!(asset.id in assetInfo)) {
                                assetInfo[asset.id] = wavesFunctions.getAssetInfo(asset.id);
                            }
                            if (!(asset.id in incentivePayouts[transaction.sender])) {
                                incentivePayouts[transaction.sender][asset.id] = 0;
                            }
                            if (asset.feePerWave > 0) {
                                var waves = transaction.amount / Math.pow(10, 8);
                                var assetAmount = waves * Math.pow(10, assetInfo[asset.id].decimals) * (asset.feePerWave / 100);
                                incentivePayouts[transaction.sender][asset.id] += assetAmount;
                            }
                            if (asset.fixedAmountPerLease > 0) {
                                var assetAmount = asset.fixedAmountPerLease * Math.pow(10, assetInfo[asset.id].decimals);
                                incentivePayouts[transaction.sender][asset.id] += assetAmount;
                            }
                        });
                    }
                }

                // check if there is a cancelled lease in it
                if (transaction.type === 9 && leases[transaction.leaseId]) {
                    leases[transaction.leaseId].cancelledAtBlock = blockChainBlock.height;
                }
                
            });
            if (myBlock) {
                // Read fees from this and previous block
                // newBlock.fees = Math.round((wavesFunctions.getFeesFromBlock(blockChainBlock) / 5) * 2); // 40% of fees of current block
                // newBlock.fees += Math.round((wavesFunctions.getFeesFromBlock(blockChainBlocks[index - 1]) / 5) *3); // 60% of fees of previous block
                newBlock.fees = Math.round(blockChainBlock.totalFee / 5 * 2); // 40% of fees of current block
                newBlock.fees += Math.round(blockChainBlocks[index -1].totalFee / 5 * 3); // 60% of fees of previous block
                if (config.paymentconfig.assetHoldersPayments.length > 0) {
                    config.paymentconfig.assetHoldersPayments.forEach(function (assetHoldersPayment) {
                        if (assetHoldersPayment.richListAtBlock) {
                            if (!(assetHoldersPayment.id in assetInfo)) {
                                assetInfo[assetHoldersPayment.id] = wavesFunctions.getAssetInfo(assetHoldersPayment.id);
                            }
                            // Read richlist only if blocks are less then 2000 ago, else its a pitty for the tokenholders
                            if (blockChainBlock.height > (lastBlockHeight - 2000)) {
                                if (!("minimumAmountInWallet" in assetHoldersPayment)) {
                                    assetHoldersPayment.minimumAmountInWallet = 0;
                                }
                                if (assetHoldersPayment.checkMinimumAtMining) {
                                    minimumAmount = assetHoldersPayment.minimumAmountInWallet * Math.pow(10, assetInfo[assetHoldersPayment.id].decimals);
                                } else {
                                    minimumAmount = 0;
                                }
                                var assetAddresses = wavesFunctions.getAssetDistributionAtBlock(assetHoldersPayment.id, blockChainBlock.height, config.paymentconfig.leasewallet, minimumAmount);
                                newBlock[assetHoldersPayment.id] = assetAddresses;
                            } else {
                                newBlock[assetHoldersPayment.id] = {addresses: {}, totalDistributed: 0};
                            }
                        }
                    });
                }
                blocks[blockChainBlock.height] = newBlock;
            }
        });
        currentStartBlock += 99;
    }
    // Write current leases
    fs.writeFile(config.toolbaseconfig.currentleasesfile, JSON.stringify(leases, null, 4), {}, function(err) {
        if (err) {
            console.error(err);
        } else {
            console.info("Leases written to file");
        }
    });
    
    // Write current blocks
    fs.writeFile(config.toolbaseconfig.currentblocksfile, JSON.stringify(blocks, null, 4), {}, function(err) {
        if (err) {
            console.error(err);
        } else {
            console.info("Blocks written to file");
        }
    });
    
    // Write batchinfo
    batchInfo.batchData.scanStartAtBlock = endAtBlock;
    fs.writeFile(config.toolbaseconfig.batchinfofile, JSON.stringify(batchInfo, null, 4), {}, function (err) {
        if (err) {
            console.error(err);
        } else {
            console.info("Batchinfo written");
            stop();
        }
    });

    // Write incentives
    fs.writeFile(config.toolbaseconfig.incentivePayoutsFile, JSON.stringify(incentivePayouts, null, 4), {}, function (err) {
        if (err) {
            console.error(err);
        } else {
            console.info('Incentive written to file');
        }
    });
}

/**
 * Stop the function and remove run-file
 */
var stop = function() {
    if (fs.existsSync(runfile)) {
        fs.unlink(runfile, function (err) {
            if (err) {
                console.log(err);
            } else {
                console.info('Runfile deleted');
            }
        });
    }
    process.exit();
}

/** Start function **/
start();