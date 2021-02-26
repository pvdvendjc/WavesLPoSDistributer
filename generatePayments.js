/**
 * These function will generate the paymentsFiles.
 * The output can be transfered to the node for payment of the lessors and the assetHolders if they are involved
 *
 */

/** Define constants **/
const request = require('sync-request');
const fs = require('fs');
const wavesFunctions = require('./wavesFunctions');
const configfile = 'config.json'
const runfile = 'generatePayments.run'
var args = process.argv.slice(2);

/** Paymentstructure **/
var payment = function(address, amount, assetId) {
    var obj = {};
    obj.address = address;
    obj.amount = amount;
    obj.assetId = assetId;
    return obj;
}

var payments = [];
var totalAmounts = {};

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

/** read start and endBlock **/
if (fs.existsSync(config.toolbaseconfig.batchinfofile)) {
    var batchInfo = JSON.parse(fs.readFileSync(config.toolbaseconfig.batchinfofile));
    var batch = null;
    switch (args[0]) {
        case 'lessors':
        case 'WAVES':
            batch = batchInfo.batchData.batches.lessors;
            var leases = JSON.parse(fs.readFileSync(config.toolbaseconfig.currentleasesfile));
            break;
        default:
            config.paymentconfig.assetHoldersPayments.forEach(function (assetHoldersPayment) {
                if (assetHoldersPayment.id in batchInfo.batchData.batches && (args[0] === assetHoldersPayment.id || args[0] === assetHoldersPayment.shortCode)) {
                    batch = batchInfo.batchData.batches[assetHoldersPayment.id];
                }
            });
            break;
    }
    if (batch === null) {
        console.info('No correct payouttype supplied.');
        stop();
    }
    batch.payedAtBlock = batchInfo.batchData.scanStartAtBlock;
    console.info(batchInfo);
}

if (fs.existsSync(config.toolbaseconfig.currentblocksfile)) {
    var blocks = JSON.parse(fs.readFileSync(config.toolbaseconfig.currentblocksfile));
} else {
    console.info('No blocks in file, run checkBlocks first');
    stop();
}

var blocksToPay = [];
// Gonna merge payouts ? or gonna accept more fees?
var payOuts = {};
var assetInfo = {};

/**
 * function to generate HTML files from payouts
 *
 */
var generateHTML = function (payOuts, fileName, batch, lessors) {
    var date = (new Date()).toLocaleDateString();
    // generate new transactions and HTML-file
    totals = {WAVES: 0};
    var html = "<!DOCTYPE html>" +
        "<html lang=\"en\">" +
        "<head>" +
        "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
        "  <link rel=\"stylesheet\" href=\"https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.min.css\">" +
        "  <script src=\"https://ajax.googleapis.com/ajax/libs/jquery/3.2.1/jquery.min.js\"></script>" +
        "  <script src=\"https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/js/bootstrap.min.js\"></script>" +
        "</head>" +
        "<body>" +
        "<div class=\"container\">" +
        "  <h3>Fees between blocks " + batch.startedAtBlock + " - " + batch.payedAtBlock + ", Payout #" + batch.payId + ", (Share Tx fees " + batch.fees.fees + "% / Blockreward " + batch.fees.rewards + "%)</h3>" +
        "  <h4>(LPOS address: " + config.paymentconfig.leasewallet + ")</h4>" +
        "  <h5>[ " + date + " ]: Hi all, again a short update of the fee's earned by the wavesnode " + config.paymentconfig.nodename + ". Greetings!</h5> " +
        "  <h5>You can always contact me by <a href=\"mailto:" + config.paymentconfig.mail + "\">E-mail</a></h5>" +
        "  <h5>Blocks forged: " + batch.blocks + "</h5>" +
        "  <table class=\"table table-striped table-hover\">" +
        "    <thead> " +
        "      <tr>" +
        "        <th>Address (# blocks)</th>" +
        "        <th>Waves</th>";

    if (lessors) {
        config.paymentconfig.extraAssets.forEach(function (asset) {
            html += "<th>" + assetInfo[asset.id].name + "</th>";
            totals[asset.id] = 0;
        });
    }

    html += "      <th></th></tr>" +
        "    </thead>" +
        "    <tbody>";

    for (address in payOuts) {
        payout = payOuts[address];
        console.info(payout);
        html += '<tr><td>' + address + ' (' + payout.blocks + ')</td>';
        for (asset in payout) {
            if (asset !== 'blocks') {
                if (asset === 'WAVES') {
                    decimals = 8;
                } else {
                    if (!(asset in assetInfo)) {
                        assetInfo[asset] = wavesFunctions.getAssetInfo(asset);
                    }
                    decimals = assetInfo[asset].decimals;
                }
                html += '<td>' + (payout[asset] / Math.pow(10, decimals)).toFixed(decimals) + '</td>';
                totals[asset] += payout[asset];
            }
        }
        html += '</tr>' + "\n";
    }
    html += '<tr><td><b>Total amount:</b></td><td><b>' + (totals.WAVES / Math.pow(10,8)).toFixed(8) + '</b></td>';
    for (asset in payout) {
        if (asset !== 'blocks' && asset !== 'WAVES') {
            html += '<td><b>' + (totals[asset] / Math.pow(10, assetInfo[asset].decimals)).toFixed(assetInfo[asset].decimals) + '</b></td>';
        }
    };
    html += '</tr>' + "\n";

    fs.writeFileSync(fileName, html, {}, function(err) {
        if (err) {
            console.error(err);
        } else {
            console.info('HTML file written');
        }
    });
}

var start = function() {
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

    for (height in blocks) {
        if (height > batch.startedAtBlock && height <= batch.payedAtBlock) {
            blocksToPay.push(blocks[height]);
        }
    }
    if (blocksToPay.length === 0) {
        console.info('Nothing to pay, goodbye');
        stop();
    }
    batch.blocks = blocksToPay.length;
    batch.payId = 1;
    batch.fees = {};
    var lessors = false;
    blocksToPay.forEach(function (block) {
        payToObject = {};
        payToObject.addresses = {};
        switch (args[0]) {
            case 'lessors':
            case 'WAVES':
                lessors = true;
                payToObject.totalLeased = 0;
                for (leaseId in leases) {
                    lease = leases[leaseId];
                    if ((lease.startedAtBlock + 1000) <= block.height && (lease.cancelledAtBlock == -1 || lease.cancelledAtBlock >= block.height)) {
                        if (!(lease.address in payToObject.addresses)) {
                            payToObject.addresses[lease.address] = {amount: 0};
                        }
                        payToObject.addresses[lease.address].amount += lease.amount;
                        payToObject.totalLeased += lease.amount;
                    }
                }
                for (address in payToObject.addresses) {
                    payTo = payToObject.addresses[address];
                    if (!(address in payOuts)) {
                        payOuts[address] = {WAVES: 0, blocks: 0};
                        config.paymentconfig.extraAssets.forEach(function (extraAsset) {
                            payOuts[address][extraAsset.id] = 0;
                        });
                    };
                    share = payTo.amount / payToObject.totalLeased;
                    payOuts[address].blocks++;
                    payOuts[address].WAVES += Math.floor(share * (
                        block.rewards * (config.paymentconfig.blockrewarddistributionpercentage / 100) +
                        block.fees * (config.paymentconfig.feedistributionpercentage / 100)));
                    config.paymentconfig.extraAssets.forEach(function (extraAsset) {
                        if (!(extraAsset.id in assetInfo)) {
                            assetInfo[extraAsset.id] = wavesFunctions.getAssetInfo(extraAsset.id);
                        }
                        payOuts[address][extraAsset.id] += Math.round(extraAsset.perBlock * share * Math.pow(10, assetInfo[extraAsset.id].decimals));
                    });
                }
                batch.fees.rewards = config.paymentconfig.blockrewarddistributionpercentage;
                batch.fees.fees = config.paymentconfig.feedistributionpercentage;
                break;
            default:
                config.paymentconfig.assetHoldersPayments.forEach(function (assetHoldersPayment) {
                    if (assetHoldersPayment.id in batchInfo.batchData.batches && (args[0] === assetHoldersPayment.id || args[0] === assetHoldersPayment.shortCode)) {
                        for (address in block[assetHoldersPayment.id].addresses) {
                            if (!(address in payOuts)) {
                                payOuts[address] = {WAVES: 0, blocks: 0};
                            }
                            share = block[assetHoldersPayment.id].addresses[address] / block[assetHoldersPayment.id].totalDistributed;
                            payOuts[address].blocks++;
                            payOuts[address].WAVES += Math.floor(share * (
                                block.rewards * (assetHoldersPayment.rewardsPercentage / 100) +
                                block.fees * (assetHoldersPayment.feePercentage / 100)));
                        }
                        batch.fees.rewards = assetHoldersPayment.rewardsPercentage;
                        batch.fees.fees = assetHoldersPayment.feePercentage;
                    }
                });
                break;
        }
    });
    console.info(payOuts);
    // generate HTML file
    console.info(batch);
    generateHTML(payOuts, 'lessors.html', batch, lessors);
    // save batchInfo
    batch.startedAtBlock = batch.payedAtBlock;
    switch (args[0]) {
        case 'lessors':
        case 'WAVES':
            batchInfo.batchData.batches.lessors = batch;
            break;
        default:
            config.paymentconfig.assetHoldersPayments.forEach(function (assetHoldersPayment) {
                if (assetHoldersPayment.id in batchInfo.batchData.batches && (args[0] === assetHoldersPayment.id || args[0] === assetHoldersPayment.shortCode)) {
                    batchInfo.batchData.batches[assetHoldersPayment.id] = batch;
                }
            });
            break;
    }
    console.info(batchInfo.batchData.batches);
    // fs.writeFileSync(config.toolbaseconfig.batchinfofile, JSON.stringify(batchInfo), {}, function (err) {
    //     if (err) {
    //         console.error(err);
    //     } else {
    //         console.info('Batch file written');
    //     }
    // });
    stop();
}

/** Start function **/
start();
