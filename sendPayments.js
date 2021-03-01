/**
 * These function will send the payments optimized to the node.
 * The output can be transfered to the node for payment of the lessors and the assetHolders if they are involved
 *
 */

/** Define constants **/
const fs = require('fs');
const request = require('sync-request');
const wavesFunctions = require('./wavesFunctions');
const configfile = 'config.json'
const runfile = 'sendPayments.run'
const bs58 = require('bs58');

var args = process.argv.slice(2);
if (args.length === 0) {
    console.info('Give message for the transaction(s)');
    process.exit();
}
var message = args[0];
if (args.length == 2) {
    var dryRun = true;
    console.info('DryRun mode, nothing will be sent');
} else {
    var dryRun = false;
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

/** Read config file **/
if (fs.existsSync(configfile)) { //configurationfile is found, let's read contents and set variables
    var config = JSON.parse(fs.readFileSync(configfile));
    wavesFunctions.setQueryNode(config.paymentconfig.querynode_api);
    wavesFunctions.setPaymentNode(config.paymentconfig.paymentnode_api);
} else {
    console.log("\n Error, configuration file '" + configfile + "' missing.\n"
        + " Please get a complete copy of the code from github. Will stop now.\n");
    return //exit program
}

var date = new Intl.DateTimeFormat('nl', {month: '2-digit', year: 'numeric', day: '2-digit', hour: '2-digit', minute: '2-digit'}).formatToParts();
var backupPrefix = date[0].value + date[1].value + date[2].value + date[3].value + date[4].value + '-' + date[6].value + ':' + date[8].value;

/** Read payqueue-file **/
if (fs.existsSync(config.toolbaseconfig.payqueuefile)) {
    var payqueue = JSON.parse(fs.readFileSync(config.toolbaseconfig.payqueuefile));
    fs.copyFile(config.toolbaseconfig.payqueuefile, backupPrefix + '_' + config.toolbaseconfig.payqueuefile + '.bak', function (err) {
        if (err) {
            console.error(err);
        }
    });
} else {
    console.log('No payqueue found, run generate payments first');
}
if (payqueue.length == 0) {
    console.log('Nothing to pay');
}

var start = function() {
    // Merge payments to one Payout file
    var mergedPayOuts = {};
    var payOuts = {};
    if (fs.existsSync(config.toolbaseconfig.incentivePayoutsFile)) {
        payqueue.push(config.toolbaseconfig.incentivePayoutsFile);
        fs.copyFile(config.toolbaseconfig.incentivePayoutsFile, backupPrefix + '_' + config.toolbaseconfig.incentivePayoutsFile + '.bak', function(err) {
            if (err) {
                console.error(err);
            }
        });
    }
    while (payqueue.length > 0) {
        paymentFile = payqueue.shift();
        payOuts = JSON.parse(fs.readFileSync(paymentFile));
        for (address in payOuts) {
            if (!(address in mergedPayOuts)) {
                mergedPayOuts[address] = payOuts[address];
            } else {
                for (asset in payOuts[address]) {
                    if (!(asset in mergedPayOuts[address])) {
                        mergedPayOuts[address][asset] = 0;
                    }
                    mergedPayOuts[address][asset] += payOuts[address][asset];
                }
            }
        }
    }
    if (!dryRun) {
        fs.writeFileSync(config.toolbaseconfig.incentivePayoutsFile, '{}', {}, function(err) {
            if (err) {
                console.error(err);
            }
        });
    }

    console.info('MergedPayouts ' , mergedPayOuts);

    var transfers = {};
    for (address in mergedPayOuts) {
        for (asset in mergedPayOuts[address]) {
            if (asset !== 'blocks') {
                if (!(asset in transfers)) {
                    transfers[asset] = [];
                }
                transfers[asset].push({recipient: address, amount: mergedPayOuts[address][asset]});
                if (transfers[asset].length == 100) {
                    // send to node
                    sendToNode(transfers[asset], asset);
                    transfers[asset] = [];
                }
            }
        }
    }
    for (asset in transfers) {
        if (transfers[asset].length > 0) {
            // send to node
            sendToNode(transfers[asset], asset);
        }
    }

    // Generate transactions for the blockchain

    if (!dryRun) {
        fs.writeFileSync(config.toolbaseconfig.payqueuefile, JSON.stringify(payqueue), {}, function(err) {
            if (err) {
                console.error(err);
            } else {
                console.info('Payqueue written');
            }
        });
    }
}

var sendToNode = function(transactions, asset) {
    var transaction = {sender: config.paymentconfig.leasewallet, assetId: asset};
    transaction.attachment = bs58.encode(Buffer.from(message));
    if (asset === 'WAVES') {
        transaction.assetId = null;
    }
    if (transactions.length > 1) {
        transaction.type = 11;
        transaction.version = 1;
        transaction.transfers = transactions;
        transaction.totalAmount = 0;
        transactions.forEach(function(trans) {
            transaction.totalAmount += trans.amount;
        });
        transaction.transferCount = transactions.length;
        transaction.fee = Math.ceil((transactions.length * 0.5) + 1) * 100000;
        transaction.proofs = [bs58.encode(Buffer.from('Signed by SWN'))];
    } else {
        transaction.type = 4;
        transaction.version = 2;
        transaction.recipient = transactions[0].recipient;
        transaction.amount = transactions[0].amount;
        transaction.fee = 100000;
    }
    var url = config.paymentconfig.paymentnode_api + config.toolbaseconfig.masstxapisuffix;
    if (!dryRun) {
        request('POST', url, {
            json: transaction,
            headers: {"Accept": "application/json", "Content-Type": "application/json", "api_key": config.paymentconfig.paymentnode_apikey}
        }, function (err) {
            if (err) {
                console.log(err);
            }
        });
    } else {
        console.info(transaction);
    }
}

start();