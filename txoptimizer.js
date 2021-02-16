const configfile = 'config.json';
const optrunfile = 'txopt.run';

var fs = require('fs');
var bs58 = require('bs58');
var request = require('sync-request');

var date = (new Date()).toLocaleDateString();

if (fs.existsSync(optrunfile)) {
    console.log("\nALERT:\n" +
        "Found txoptrun interruptionfile. Apparently txoptimizer was interupted abnormally last time!\n" +
        "Normally if optimizer sessions run 100% fine, this alert should not be given.\n" +
        "Check your logs and if everything is fine, delete the crashfile: '" + optrunfile + "'\n" +
        "\nGoodbye now!\n")
    return; //Terminate
} else {
    fs.closeSync(fs.openSync(optrunfile, 'w'));
}

if (fs.existsSync(configfile)) {
    var configuration = JSON.parse(fs.readFileSync(configfile));
    var toolConfigData = configuration.toolbaseconfig;
    var paymentConfigData = configuration.paymentconfig;
    if (toolConfigData.optimizerdir === 'undefined') {
        toolConfigData.optimizerdir = 'txoptimizer';
        configuration.toolbaseconfig.optimizerdir = 'txtoptimizer';
        fs.writeFileSync(configfile, JSON.stringify(configuration), {}, function(err) {
            if (err) {
                console.info('Config file not writeable, exiting now');
                process.exit();
            }
        })
    }
    if (!fs.existsSync('./' + toolConfigData.optimizerdir)) {
        fs.mkdir('./' + toolConfigData.optimizerdir, '0744', function(err) {
            if (err) {
                console.info(err);
                process.exit();
            }
        });
    }
} else {
    console.log('No configuration file found');
    return;
}

/**
 * Method to return info about assets which are used in this script to pay a part of the wavesfees to
 *
 * @returns Object with assetinfo
 **/
var getAssetInfo = function() {
    var localInfo = {};
    paymentConfigData.assetHoldersPayments.forEach(function (asset) {
        var url = paymentConfigData.querynode_api + '/assets/details/' + asset.id + '?full=true';
        var info = JSON.parse(request('GET', url, {'headers': {
                'Connection': 'keep-alive'
            }
        }).getBody('utf8'));
        localInfo[asset.id] = info;
    });
    return localInfo;
}

var blockCount = 0;
var paymentTransactions = [];
var startBlock = 0;
var endBlock = 0;
var assetInfo = {};
var extensions = ['json', 'html', 'log'];
var batchInfo = JSON.parse(fs.readFileSync(toolConfigData.batchinfofile));
var firstPayIds = {};
var startBlocks = {WAVES: 0};
var endBlocks = {WAVES: 0};
var blockCounts = {WAVES: 0};

var start = function() {
    console.info("Get asset info");
    assetInfo = getAssetInfo();
    console.info('Collect all payments from jsonFiles');
    var payments = {};
    var tokenPayments = {};
    var totalFees = {WAVES: 0};
    firstPayIds.WAVES = firstPayId;
    paymentConfigData.extraAssets.forEach(function(asset) {
        totalFees[asset.id] = 0;
        startBlocks[asset.id] = 0;
        endBlocks[asset.id] = 0;
        blockCounts[asset.id] = 0;
    });
    // merge payqueue
    payqueue.lessors.forEach(function (payid) {
        // load lessorsPayOutFile
        var fileName = toolConfigData.payoutfilesprefix + payid + '.json';
        var batchInfo = JSON.parse(fs.readFileSync(fileName));
        blockCounts.WAVES += batchInfo.blocks;
        if (startBlocks.WAVES === 0) {
            startBlocks.WAVES = batchInfo.startblock;
        }
        endBlocks.WAVES = batchInfo.endblock;
        batchInfo.transactions.forEach(function (transaction) {
            if (!(transaction.recipient in payments)) {
                payments[transaction.recipient] = {WAVES: 0, blocks: 0};
            }
            if (transaction.assetId !== '' && !(transaction.assetId in payments[transaction.recipient])) {
                payments[transaction.recipient][transaction.assetId] = 0;
            }
            var asset = transaction.assetId !== '' ? transaction.assetId : 'WAVES';
            payments[transaction.recipient][asset] += transaction.amount;
            payments[transaction.recipient].blocks += transaction.assetId === '' ? transaction.blocks : 0;
        });
        var file = toolConfigData.payoutfilesprefix + payid;
        extensions.forEach(function(extension) {
            extension = '.' + extension;
            var newFileName = file + '_to_' + firstPayId + extension;
            fs.rename(file + extension, './' + toolConfigData.optimizerdir + '/' + newFileName, function (err) {
                if (err) {
                    console.log(err);
                    process.exit();
                }
            });
        });
    });
    paymentConfigData.assetHoldersPayments.forEach(function(assetHolder) {
        firstPayIds[assetHolder.id] = payqueue.assetHolders[assetHolder.id][0];
        payqueue.assetHolders[assetHolder.id].forEach(function (payid) {
            var fileName = assetHolder.payoutFilePrefix + payid + '.json';
            tokenPayments[assetHolder.id] = {};
            var payOutObject = JSON.parse(fs.readFileSync(fileName));
            if (startBlocks[assetHolder.id] == 0) {
                startBlocks[assetHolder.id] = payOutObject.startblock;
            }
            endBlocks[assetHolder.id] = payOutObject.endblock;
            blockCounts[assetHolder.id] += payOutObject.blocks;
            payOutObject.transactions.forEach(function(transaction) {
                if (!(transaction.address in tokenPayments[assetHolder.id])) {
                    tokenPayments[assetHolder.id][transaction.recipient] = 0;
                }
                tokenPayments[assetHolder.id][transaction.recipient] += transaction.amount;
            });
            var file = assetHolder.payoutFilePrefix + payid;
            extensions.forEach(function(extension) {
                extension = '.' + extension;
                var newFileName = file + '_to_' + firstPayIds[assetHolder.id] + extension;
                fs.rename(file + extension, './' + toolConfigData.optimizerdir + '/' + newFileName, function (err) {
                    if (err) {
                        console.log(err);
                        process.exit();
                    }
                });
            });

            payqueue.assetHolders[assetHolder.id] = payqueue.assetHolders[assetHolder.id].filter(function(value, index, arr) {
                return value !== payid;
            });
        });
    });

    // generate new transactions and HTML-file
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
        "  <h3>Fees between blocks " + startBlocks.WAVES + " - " + endBlock.WAVES + ", Payout #" + firstPayIds.WAVES + ", (Share Tx fees " + paymentConfigData.feedistributionpercentage + "% / Blockreward " + paymentConfigData.blockrewarddistributionpercentage + "%)</h3>" +
        "  <h4>(LPOS address: " + paymentConfigData.leasewallet + ")</h4>" +
        "  <h5>[ " + date + " ]: Hi all, again a short update of the fee's earned by the wavesnode 'Stake-Waves.Net'. Greetings!</h5> " +
        "  <h5>You can always contact me by <a href=\"mailto:" + paymentConfigData.mail + "\">E-mail</a></h5>" +
        "  <h5>Blocks forged: " + blockCounts.WAVES + "</h5>" +
        "  <table class=\"table table-striped table-hover\">" +
        "    <thead> " +
        "      <tr>" +
        "        <th>Address (# blocks)</th>" +
        "        <th>Waves</th>";

    paymentConfigData.extraAssets.forEach(function(asset) {
        html += "<th>" + assetInfo[asset.id].name + "</th>";
    });

    html += "      <th></th></tr>" +
        "    </thead>" +
        "    <tbody>";

    for (var address in payments) {
        html += "<tr><td>" + address + " (" + payments[address].blocks + ")</td>";
        var payout = paymentConfigData.nopayoutaddresses.indexOf(address) == -1 ? "yes" : "no";
        paymentTransactions.push({
            amount: payments[address].WAVES,
            blocks: payments[address].blocks,
            sender: paymentConfigData.leasewallet,
            recipient: address,
            assetId: '',
            payout: payout
        });
        var addition = "";
        if (payments[address].WAVES < (paymentConfigData.minimumWavesPayout * Math.pow(10,8))) {
            addition = " * ";
        }
        html += "<td>" + (payments[address].WAVES / Math.pow(10,8)).toFixed(8) + addition + "</td>";
        totalFees.WAVES += payments[address].WAVES;
        paymentConfigData.extraAssets.forEach(function (asset) {
            var addition = "";
            if (asset.id in payments[address]) {
                var assetAmount = payments[address][asset.id];
                paymentTransactions.push({
                    amount: assetAmount,
                    blocks: 0,
                    sender: paymentConfigData.leasewallet,
                    recipient: address,
                    assetId: asset.id,
                    payout: payout
                });
                totalFees[asset.id] += payments[address][asset.id];
                if (assetAmount < asset.minPayout * (Math.pow(10, assetInfo[asset.id].decimals))) {
                    addition = " ** ";
                }
            } else {
                assetAmount = 0;
            }
            html += '<td>' + (assetAmount/Math.pow(10, assetInfo[asset.id].decimals)).toFixed(assetInfo[asset.id].decimals) + addition + "</td>";
        });
        var addition = payout == "no" ? "* NO PAYOUT *" : "";
        html += "<td>" + addition + "</td>";
        html += "</tr>\r\n";
    }
    html += "<tr><td><b>Total amount</b></td><td><b>" + ((totalFees.WAVES / 100000000).toFixed(8)) +
        "</b></td>";

    paymentConfigData.extraAssets.forEach(function (asset) {
        html += "<td><b>" + (totalFees[asset.id] / Math.pow(10, assetInfo[asset.id].decimals)).toFixed(assetInfo[asset.id].decimals) + "</b></td>";
    })

    html += "<td></td></tr>" +
        "\r\n";

    html += "</tbody>" +
        "  </table>" +
        "</div>" +
        "<div class=\"container\">* => Payout will be hold till lowest payout is reached (" + paymentConfigData.minimumWavesPayout + " WAVES)</div>";
    paymentConfigData.extraAssets.forEach(function(asset) {
        html += "<div class=\"container\">** => Payout will be hold till lowest payout is reached (" + asset.minPayout + " " + assetInfo[asset.id].name + ")</div>"
    });
    html += "</body>" +
        "</html>";

    var paymentfile = toolConfigData.payoutfilesprefix + firstPayId + '.json';
    var htmlfile = toolConfigData.payoutfilesprefix + firstPayId +  ".html";
    var logfile = toolConfigData.payoutfilesprefix + firstPayId + ".log";

    var payment = {
        payid: firstPayIds.WAVES,
        blocks: blockCount,
        startblock: startBlocks.WAVES,
        endblock: endBlocks.WAVES,
        transactions: paymentTransactions
    };
    fs.writeFileSync(paymentfile, JSON.stringify(payment), function (err) {
        console.info(paymentfile);
        if (!err) {
            console.log('Planned payments written to ' + paymentfile + '!');
        } else {
            console.log(err);
        }
    });

    fs.writeFileSync(htmlfile, html, {}, function (err) {
        if (!err) {
            console.log('HTML written to ' + htmlfile + '!');
        } else {
            console.log(err);
        }
    });

    // Create logfile with paymentinfo for reference and troubleshooting
    var logString = "";
    paymentConfigData.extraAssets.forEach(function (asset) {
        var decimals = assetInfo[asset.id].decimals;
        logString += "Total " + assetInfo[asset.id].name + " fees to lessors: " + (totalFees[asset.id] / Math.pow(10, decimals)).toFixed(decimals) + "\n";
    })
    fs.writeFileSync(logfile,
        "total Waves fees to lessors: " + (totalFees.WAVES / 100000000).toFixed(8) + "\n"
        + logString
        + "Total blocks forged: " + blockCounts.WAVES + "\n"
        + "Payment ID of batch session: " + firstPayIds.WAVES + "\n"
        + "Payment startblock: " + startBlocks.WAVES + "\n"
        + "Payment stopblock: " + endBlocks.WAVES + "\n"
        + "Distribution: " + paymentConfigData.feedistributionpercentage + "%\n"
        + "Blockreward sharing: " + paymentConfigData.blockrewarddistributionpercentage + "%\n"
        + "Following addresses are skipped for payment; \n"
        + JSON.stringify(paymentConfigData.nopayoutaddresses) + "\n", {}, function (err) {
            if (!err) {
                console.log('Summarized payoutinfo is written to ' + logfile + "!");
                console.log();
            } else {
                console.log(err);
            }
        });

    batchInfo.batchdata.paymentids.lessors = firstPayId + 1;

    // End create logfile
    paymentConfigData.assetHoldersPayments.forEach(function (assetHolder) {
        paymentTransactions = [];
        totalFees = 0;
        // generate new transactions and HTML-file
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
            "  <h3>Fees between blocks " + startBlocks[assetHolder.id] + " - " + endBlocks[assetHolder.id] + ", Payout #" + firstPayIds[assetHolder.id] + ", (Share Tx fees " + assetHolder.feePercentage + "% / Blockreward " + assetHolder.rewardsPercentage + "%)</h3>" +
            "  <h4>(LPOS address: " + paymentConfigData.leasewallet + ")</h4>" +
            "  <h5>[ " + date + " ]: Hi all, again a short update of the fee's earned by the wavesnode 'Stake-Waves.Net'. Greetings!</h5> " +
            "  <h5>You can always contact me by <a href=\"mailto:" + paymentConfigData.mail + "\">E-mail</a></h5>" +
            "  <h5>Blocks forged: " + blockCounts[assetHolder.id] + "</h5>" +
            "  <table class=\"table table-striped table-hover\">" +
            "    <thead> " +
            "      <tr>" +
            "        <th>Address</th>" +
            "        <th>Waves</th>" +
            "      <th></th></tr>" +
            "    </thead>" +
            "    <tbody>";

        for (var address in tokenPayments[assetHolder.id]) {
            var amount = tokenPayments[assetHolder.id][address]
            paymentTransactions.push({
                amount: amount,
                sender: paymentConfigData.leasewallet,
                recipient: address,
                assetId: ""
            });
            var addition = "";
            if (amount < (paymentConfigData.minimumWavesPayout * Math.pow(10,8))) {
                addition = " * ";
            }
            html += "<tr><td>" + address + "</td><td>" + (amount / Math.pow(10, 8)).toFixed(8) + addition + "</td></tr>";
            totalFees += amount;
        }
        html += "<tr><td><b>Total amount</b></td><td><b>" + ((totalFees / 100000000).toFixed(8)) +
            "</b></td></tr>";
        html += "</tbody>" +
            "  </table>" +
            "</div>" +
            "<div class=\"container\">* => Payout will be hold till lowest payout is reached (" + paymentConfigData.minimumWavesPayout + " WAVES)</div>" +
            "</body>" +
            "</html>";

        var paymentfile = assetHolder.payoutFilePrefix + firstPayIds[assetHolder.id] + '.json';
        var htmlfile = assetHolder.payoutFilePrefix + firstPayIds[assetHolder.id] +  ".html";

        var payment = {
            payid: firstPayIds[assetHolder.id],
            blocks: blockCounts[assetHolder.id],
            startblock: startBlocks[assetHolder.id],
            endblock: endBlocks[assetHolder.id],
            transactions: paymentTransactions
        };
        fs.writeFileSync(paymentfile, JSON.stringify(payment), function (err) {
            console.info(paymentfile);
            if (!err) {
                console.log('Planned payments written to ' + paymentfile + '!');
            } else {
                console.log(err);
            }
        });

        fs.writeFileSync(htmlfile, html, {}, function (err) {
            if (!err) {
                console.log('HTML written to ' + htmlfile + '!');
            } else {
                console.log(err);
            }
        });

        batchInfo.batchdata.paymentids.assetHolders[assetHolder.id] = firstPayIds[assetHolder.id] + 1;

    });
    console.info("Update payqueue file");
    payqueue.lessors = [firstPayId];
    paymentConfigData.assetHoldersPayments.forEach(function(assetHolder) {
        payqueue.assetHolders[assetHolder.id].push(firstPayIds[assetHolder.id]);
    });
    fs.writeFileSync(toolConfigData.payqueuefile, JSON.stringify(payqueue), function (err) {
        if (err) {
            console.error(err);
            process.exit();
        }
    });
    fs.writeFileSync(toolConfigData.batchinfofile, JSON.stringify(batchInfo), function (err) {
        if (err) {
            console.error(err);
            process.exit();
        }
    });
    end();
}

var end = function() {
    fs.unlink(optrunfile, (err) => { //All done, remove run file which is checked during startup
        if (err) {
            console.error(err)
        }
    });
    console.info('All done');
    process.exit();
}

if (fs.existsSync(toolConfigData.payqueuefile)) {
    var payqueue = JSON.parse(fs.readFileSync(toolConfigData.payqueuefile));
    var firstPayId = payqueue.lessors[0];
    if (payqueue.lessors.length === 1) {
        console.info('Only one batch, nothing to optimize');
        end();
    }
} else {
    console.info('No payqueue file, run collector first');
    end();
}

start();

