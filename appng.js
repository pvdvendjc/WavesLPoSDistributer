const configfile = 'config.json'
const appngrunfile = 'appng.run'

var request = require('sync-request');
var fs = require('fs');
var bs58 = require('bs58');

var dateObject = (new Date());
var date = dateObject.toLocaleDateString();
var payarray = [];

if (fs.existsSync(appngrunfile)) {
    console.log("\nALERT:\n" +
        "Found appng interruptionfile. Apparently appng was interupted abnormally last time!\n" +
        "Normally if collector sessions run 100% fine, this alert should not be given.\n" +
        "Check your logs and if everything is fine, delete the crashfile: '" + appngrunfile + "'\n" +
        "\nGoodbye now!\n")
    return; //Terminate
} else {
    fs.closeSync(fs.openSync(appngrunfile, 'w'));
}

if (fs.existsSync(configfile)) { //configurationfile is found, let's read contents and set variables

    const rawconfiguration = fs.readFileSync(configfile);
    const jsonconfiguration = JSON.parse(rawconfiguration);

    var toolconfigdata = jsonconfiguration.toolbaseconfig;
    var paymentconfigdata = jsonconfiguration.paymentconfig;

    //define all vars related to the payment settings
    var myquerynode = paymentconfigdata.querynode_api;
    var feedistributionpercentage = paymentconfigdata.feedistributionpercentage;
    var myleasewallet = paymentconfigdata.leasewallet;
    var attachment = paymentconfigdata.transactionattachment;
    var startscanblock = paymentconfigdata.firstleaserblock;
    var paymentstartblock = paymentconfigdata.paystartblock;
    var blockwindowsize = paymentconfigdata.blockwindowsize;
    var nofeearray = paymentconfigdata.nopayoutaddresses;
    var mailto = paymentconfigdata.mail;
    var blockrewardsharingpercentage = paymentconfigdata.blockrewarddistributionpercentage;
    //define all vars related to the tool settings
    var batchinfofile = toolconfigdata.batchinfofile;
    var payqueuefile = toolconfigdata.payqueuefile;
    var payoutfilesprefix = toolconfigdata.payoutfilesprefix;
} else {
    console.log("\n Error, configuration file '" + configfile + "' missing.\n"
        + " Please get a complete copy of the code from github. Will stop now.\n");
    return //exit program
}

var bsInfoExists = false;
if (fs.existsSync(batchinfofile)) {

    var rawbatchinfo = fs.readFileSync(batchinfofile);
    var batchinfo = JSON.parse(rawbatchinfo);

    mybatchdata = batchinfo.batchdata;
    paymentstartblock = mybatchdata.paystartblock; //block where to start payments
    paymentstopblock = mybatchdata.paystopblock; //block UNTIL (tot) to get payments
    startscanblock = mybatchdata.scanstartblock;
    payid = mybatchdata.paymentid;

    bsInfoExists = true;

} else { //Did not find batchinfofile, so it's probably first collector run

    payid = 1;
    paymentstopblock = startscanblock + blockwindowsize;

    var batchinfo = {
        "batchdata": {
            "paymentids": {lessors: payid, assetHolders: {}},
            "scanstartblock": startscanblock,
            "paystartblock": paymentstartblock,
            "paystopblock": paymentstopblock
        }
    };

    paymentconfigdata.assetHolders.forEach(function(assetHolder) {
        batchinfo.batchdata.paymentids.assetHolders[assetHolder.id] = payid;
    })
    mybatchdata = batchinfo.batchdata;

    console.log("\n Batchfile '" + batchinfofile + "' is missing. This seems to be the first collector session." +
        "\n The collector will start with the following batch details:\n" +
        "\n  - paymentID: " + payid +
        "\n  - Start scanning from block: " + startscanblock +
        "\n  - Scan till block: " + paymentstopblock +
        "\n  - Blockwindowsize: " + blockwindowsize + " blocks" +
        "\n  - First relevant payoutblock: " + paymentstartblock + "\n" +
        " =============================================================================================\n");
}

// Collect height of last block in waves blockchain
let options = {
    uri: "/blocks/height",
    baseUrl: myquerynode,
    method: "GET",
    headers: {
        json: true
    }
};

let blockchainresponse = request(options.method, options.baseUrl + options.uri, options.headers)
let lastblockheight = parseInt(JSON.parse(blockchainresponse.body).height)

if (paymentstopblock > lastblockheight - 100) {
    let blocksleft = paymentstopblock - lastblockheight - 100
    console.log("\n Current blockheight is " + lastblockheight + ". Waiting to reach " + paymentstopblock + " for next collector round.");
    console.log(" This is approximaly in ~" + Math.round((blocksleft) / 60) + " hrs (" + (Math.round((blocksleft / 60 / 24) * 100)) / 100 + " days).\n");

    fs.unlink(appngrunfile, (err) => { //All done, remove run file which is checked during startup
        if (err) {
            console.error(err);
        }
    });
    return;

} else if (bsInfoExists) {
    fs.writeFileSync(batchinfofile + ".bak", fs.readFileSync(batchinfofile));
}  //Create backup of batchdatafile

var config = {
    address: myleasewallet,
    startBlockHeight: paymentstartblock,
    endBlock: paymentstopblock,
    filename: payoutfilesprefix, //.json added automatically
    paymentid: payid,
    node: myquerynode,
    assetFeeId: null, //not used anymore with sponsored tx
    feeAmount: parseInt(toolconfigdata.txbasefee),
    paymentAttachment: bs58.encode(Buffer.from(attachment)),
    percentageOfFeesToDistribute: feedistributionpercentage,
    percentageOfBlockrewardToDistribute: blockrewardsharingpercentage,
    extraAssets: paymentconfigdata.extraAssets,
    assetHoldersPayments: paymentconfigdata.assetHoldersPayments
};

var myLeases = {};
var myCanceledLeases = {};

var currentStartBlock = startscanblock;

var prevleaseinfofile = config.startBlockHeight + "_" + config.address + ".json";
if (fs.existsSync(prevleaseinfofile)) {
    console.log("reading " + prevleaseinfofile + " file");
    var data = fs.readFileSync(prevleaseinfofile);
    var prevleaseinfo = JSON.parse(data);
    myLeases = prevleaseinfo["leases"];
    myCanceledLeases = prevleaseinfo["canceledleases"];
    currentStartBlock = config.startBlockHeight;
}

//do some cleaning
var cleancount = 0;
for (var cancelindex in myCanceledLeases) {
    if (myCanceledLeases[cancelindex].leaseId in myLeases) {
        //remove from both arrays, we don't need them anymore
        delete myLeases[cancelindex];
        delete myCanceledLeases[cancelindex];
        cleancount++;
    }
}
console.log("done cleaning, removed: " + cleancount);

var payments = [];
var tokenPayments = {};
var myAliases = [];
var BlockCount = 0;
var LastBlock = {};
var myForgedBlocks = [];
var assetInfo = {};

/**
 * This method starts the overall process by first downloading the blocks,
 * preparing the necessary datastructures and finally preparing the payments
 * and serializing them into a file that could be used as input for the
 * masspayment tool.
 */
var start = function () {
    console.log('getAsset info');
    assetInfo = getAssetInfo();
    console.log('get aliases');
    myAliases = getAllAlias();
    console.log('getting blocks...');
    var blocks = getAllBlocks();
    console.log('preparing datastructures...');
    prepareDataStructure(blocks);
    console.log('preparing payments...');
    var tokenDistributionData = {};
    myForgedBlocks.forEach(function (block) {
        if (block.height >= config.startBlockHeight && block.height <= config.endBlock) {
            var blockLeaseData = getActiveLeasesAtBlock(block);
            config.assetHoldersPayments.forEach(function (asset) {
                tokenDistributionData[asset.id] = getAssetDistributionAtBlock(asset.id, block);
            });

            distribute(block, blockLeaseData, tokenDistributionData);
            BlockCount++;
        }
    });
    //Get last block
    LastBlock = blocks.slice(-1)[0];
    pay();
    console.log("blocks forged: " + BlockCount);
};

/**
 * This method organizes the datastructures that are later on necessary
 * for the block-exact analysis of the leases.
 *
 *   @param blocks all blocks that should be considered
 */

var prepareDataStructure = function (blocks) {
    blocks.forEach(function (block, index) { //BEGIN for each block loop
        var checkprevblock = false;
        var myblock = false;
        var wavesFees = 0;

        if (block.generator === config.address) {
            myForgedBlocks.push(block);
            checkprevblock = true;
            myblock = true;
        }

        var blockwavesfees = 0;

        block.transactions.forEach(function (transaction) {
            // type 8 are leasing tx
            if (transaction.type === 8 && ((transaction.recipient === config.address) || (myAliases.indexOf(transaction.recipient) > -1))) {
                transaction.block = block.height;
                myLeases[transaction.id] = transaction;
            } else if (transaction.type === 9 && myLeases[transaction.leaseId]) { // checking for lease cancel tx
                transaction.block = block.height;
                myCanceledLeases[transaction.leaseId] = transaction;
            }

            if (myblock) {
                // considering Waves fees
                if (!transaction.feeAsset || transaction.feeAsset === '' || transaction.feeAsset === null) {
                    if (transaction.fee < 200000000) { // if tx waves fee is more dan 2 waves, filter it. probably a mistake by someone
                        //wavesFees += (transaction.fee*0.4);
                        blockwavesfees += transaction.fee;
                    } else {
                        console.log("Filter TX at block: " + block.height + " Amount: " + transaction.fee)
                    }
                } else if (block.height > 1090000 && transaction.type === 4) {
                    blockwavesfees += 100000;
                }
            }
        });
        wavesFees += Math.round(parseInt(blockwavesfees / 5) * 2);

        blockwavesfees = 0;

        if (checkprevblock) {
            if (index > 0) {
                //console.log("Next: " + blocks[index + 1]);
                var prevblock = blocks[index - 1];
                prevblock.transactions.forEach(function (transaction) {
                    // considering Waves fees
                    if (!transaction.feeAsset || transaction.feeAsset === '' || transaction.feeAsset === null) {
                        if (transaction.fee < 200000000) // if tx waves fee is more dan 2 waves, filter it. probably a mistake by someone
                        {
                            //wavesFees += (transaction.fee*0.6);
                            blockwavesfees += transaction.fee;
                        } else {
                            console.log("Filter TX at block: " + block.height + " Amount: " + transaction.fee)
                        }
                    } else if (block.height > 1090000 && transaction.type === 4) {
                        blockwavesfees += 100000;
                    }

                });
            }

            wavesFees += (blockwavesfees - Math.round(parseInt(blockwavesfees / 5) * 2));

        }

        block.wavesFees = {};
        block.wavesFees.lessors = (wavesFees * config.percentageOfFeesToDistribute / 100) //These are the Txs fees with sharing % applied from configfile
        config.assetHoldersPayments.forEach(function (asset) {
            block.wavesFees[asset.id] = (wavesFees * asset.feePercentage / 100);
        });

        if (myblock) {  //This block is written by my waves node
            // This is the blockreward amount with sharing % applied from configfile
            if (block.height >= 1740000) {
                block.wavesFees.lessors += (block.reward * blockrewardsharingpercentage) / 100;
                config.assetHoldersPayments.forEach(function (asset) {
                    block.wavesFees[asset.id] += (block.reward * asset.rewardsPercentage) /100;
                });
            } //Feature 14 activated at 1740000
        }
    }); //END for each block loop
};

/**
 * Method that returns all relevant blocks.
 *
 * @returns {Array} all relevant blocks
 */
var getAllBlocks = function () {
    // leases have been resetted in block 462000, therefore, this is the first relevant block to be considered
    //var firstBlockWithLeases=462000;
    //var currentStartBlock = firstBlockWithLeases;
    var blocks = [];

    while (currentStartBlock < config.endBlock) {
        var currentBlocks;

        if (currentStartBlock + 99 < config.endBlock) {
            console.log('getting blocks from ' + currentStartBlock + ' to ' + (currentStartBlock + 99));
            currentBlocks = JSON.parse(request('GET', config.node + '/blocks/seq/' + currentStartBlock + '/' + (currentStartBlock + 99), {
                'headers': {
                    'Connection': 'keep-alive'
                }
            }).getBody('utf8'));
        } else {
            console.log('getting blocks from ' + currentStartBlock + ' to ' + config.endBlock);
            currentBlocks = JSON.parse(request('GET', config.node + '/blocks/seq/' + currentStartBlock + '/' + config.endBlock, {
                'headers': {
                    'Connection': 'keep-alive'
                }
            }).getBody('utf8'));
        }
        currentBlocks.forEach(function (block) {
            if (block.height <= config.endBlock) {
                blocks.push(block);
            }
        });

        if (currentStartBlock + 100 < config.endBlock) {
            currentStartBlock += 100;
        } else {
            currentStartBlock = config.endBlock;
        }
    }

    return blocks;
};

/**
 * Method to return info about assets which are used in this script to pay a part of the wavesfees to
 *
 * @returns Object with assetinfo
 **/
var getAssetInfo = function() {
    var localInfo = {};
    config.assetHoldersPayments.forEach(function (asset) {
        var url = config.node + '/assets/details/' + asset.id + '?full=true';
        var info = JSON.parse(request('GET', url, {'headers': {
                'Connection': 'keep-alive'
            }
        }).getBody('utf8'));
        localInfo[asset.id] = info;
    });
    return localInfo;
}

/**
 * Method that returns all aliases for address.
 *
 * @returns {Array} all aliases for address
 */
var getAllAlias = function () {

    var AliasArr = [];
    var Aliases = JSON.parse(request('GET', config.node + '/alias/by-address/' + config.address, {
        'headers': {
            'Connection': 'keep-alive'
        }
    }).getBody('utf8'));

    Aliases.forEach(function (alias) {
        AliasArr.push(alias);
        console.log(alias);
    });
    return AliasArr;
}

/**
 * This method distributes either Waves fees and MRT to the active leasers for
 * the given block.
 *
 * @param activeLeases active leases for the block in question
 * @param amountTotalLeased total amount of leased waves in this particular block
 * @param block the block to consider
 */
var distribute = function (block, blockLeaseData, tokenDistributeData) {

    var activeLeases = blockLeaseData.activeLeases;
    var amountTotalLeased = blockLeaseData.totalLeased;
    var fee = block.wavesFees.lessors; //total waves fee amount + blockreward with sharing % from configfile applied

    for (var address in activeLeases) {

        if (nofeearray.indexOf(address) == -1) {	// leaseaddress is not marked as 'no pay address'
            var share = (activeLeases[address] / amountTotalLeased); //what is the share ratio for this address
            var payout = true;
        } else {					//this address will not get payed
            var share = (activeLeases[address] / amountTotalLeased); //what is the share ratio for this address
            var payout = false;
        }

        var amount = fee * share; //The Waves amount per address according ratio

        if (!(address in payments)) { //Address already in array, add to amount
            payments[address] = {'WAVES' : 0, blocks: 0};
            config.extraAssets.forEach(function (asset) {
                payments[address][asset.id] = 0;
            });
        }
        payments[address].WAVES += amount //How many Waves fees leaser gets
        payments[address].blocks++;
        config.extraAssets.forEach(function (asset) {
            payments[address][asset.id] += share * asset.perBlock * Math.pow(10, assetInfo[asset.id].decimals)
        });

        if (payout == true) {
            console.log(address + ' will receive ' + (amount/Math.pow(10, 8)).toFixed(8) + ' Waves for block: ' + block.height + ' share: ' + share);
        } else if (payout == false) {
            console.log(address + ' marked as NOPAYOUT: ' + (amount/Math.pow(10, 8)).toFixed(8) + ' of Waves for block: ' + block.height + ' share: ' + share);
        }
    }

    for (var assetId in tokenDistributeData) {
        var asset = tokenDistributeData[assetId];
        if (!(assetId in tokenPayments)) {
            tokenPayments[assetId] = {};
        }
        for (var address in asset.addresses) {
            share = asset.addresses[address] / asset.totalDistributed;
            var amount = block.wavesFees[assetId] * share;
            if (!(address in tokenPayments[assetId])) {
                tokenPayments[assetId][address] = {'WAVES': 0};
            }
            tokenPayments[assetId][address].WAVES += amount;
        }
    }
};

/**
 * Method that creates the concrete payment tx and writes it to the file
 * configured in the config section.
 */
var pay = function () {
    var transactions = [];
    var totalfees = {'WAVES': 0};
    config.extraAssets.forEach(function(asset) {
        totalfees[asset.id] = 0;
    })
    var nopaywaves = 0
    var nopayaddresscount = 0

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
        "  <h3>Fees between blocks " + config.startBlockHeight + " - " + config.endBlock + ", Payout #" + batchinfo.batchdata.paymentids.lessors + ", (Share Tx fees " + config.percentageOfFeesToDistribute + "% / Blockreward " + config.percentageOfBlockrewardToDistribute + "%)</h3>" +
        "  <h4>(LPOS address: " + config.address + ")</h4>" +
        "  <h5>[ " + date + " ]: Hi all, again a short update of the fee's earned by the wavesnode 'Stake-Waves.Net'. Greetings!</h5> " +
        "  <h5>You can always contact me by <a href=\"mailto:" + mailto + "\">E-mail</a></h5>" +
        "  <h5>Blocks forged: " + BlockCount + "</h5>" +
        "  <table class=\"table table-striped table-hover\">" +
        "    <thead> " +
        "      <tr>" +
        "        <th>Address (# blocks)</th>" +
        "        <th>Waves</th>";
    config.extraAssets.forEach(function(asset) {
        html += "<th>" + assetInfo[asset.id].name + "</th>";
    });
    html += "      <th></th></tr>" +
        "    </thead>" +
        "    <tbody>";

    for (var address in payments) { //Start for all addresses in payments array
        var payment = (payments[address]['WAVES'] / Math.pow(10, 8));

        if (nofeearray.indexOf(address) == -1) { //This address will get payed (it's not found in nopay array)

            payout = true

            console.log(address + ' will receive ' + parseFloat(payment).toFixed(8) + ' Waves in total!')

            //send Waves fee
            if (Number(Math.round(payments[address].WAVES)) > 0) {
                transactions.push({
                    "amount": Number(Math.round(payments[address].WAVES)),
                    "blocks": payments[address].blocks,
                    "fee": config.feeAmount,
                    //"feeAssetId": config.assetFeeId,
                    "sender": config.address,
                    "attachment": config.paymentAttachment,
                    "recipient": address,
                    "assetId": '',
                    "pay": "yes"
                });
            }

            //send extra Tokens
            config.extraAssets.forEach(function (asset) {
                if (Number(Math.round(payments[address][asset.id])) > 0) {
                    transactions.push({
                        "amount": Number(Math.round(payments[address][asset.id])),
                        "fee": config.feeAmount,
                        //"feeAssetId": config.assetFeeId,
                        "assetId": asset.id,
                        "sender": config.address,
                        "attachment": config.paymentAttachment,
                        "recipient": address,
                        "pay": "yes"
                    });
                }
            });

        } else { //NOPAYOUT address, will not get payed

            payout = false
            nopayaddresscount++

            console.log(address + ' marked as NOPAYOUT, will not receive ' + parseFloat(payment).toFixed(8) + ' and ' + parseFloat(mrt[address]).toFixed(2) + ' MRT!')

            //send Waves fee
            if (Number(Math.round(payments[address].WAVES)) > 0) {
                nopaywaves += payments[address]['WAVES'];
                transactions.push({
                    "amount": Number(Math.round(payments[address].WAVES)),
                    "blocks": payments[address].blocks,
                    "fee": config.feeAmount,
                    //"feeAssetId": config.assetFeeId,
                    "sender": config.address,
                    "attachment": config.paymentAttachment,
                    "recipient": address,
                    "pay": "no"
                });
            }

            //send extra Tokens
            config.extraAssets.forEach(function (asset) {
                if (Number(Math.round(payment[address][asset.id])) > 0) {
                    transactions.push({
                        "amount": Number(Math.round(payment[address][asset.id])),
                        "fee": config.feeAmount,
                        //"feeAssetId": config.assetFeeId,
                        "assetId": asset.id,
                        "sender": config.address,
                        "attachment": config.paymentAttachment,
                        "recipient": address,
                        "pay": "no"
                    });
                }
            });

        }

        totalfees.WAVES += payments[address].WAVES;
        config.extraAssets.forEach(function (asset) {
            if (!(asset.id in totalfees)) {
                totalfees[asset.id] = 0;
            }
            totalfees[asset.id] += payments[address][asset.id];
        })

        var addString= '';
        if (payments[address].WAVES < (paymentconfigdata.minimumWavesPayout * Math.pow(10,8))) {
            addString = ' *';
        }
        html += "<tr><td>" + address + " (" + payments[address].blocks + ")</td><td>" + 							 	//address column
            ((payments[address].WAVES / 100000000).toFixed(8)) + addString + "</td>"; //Waves fee's
        config.extraAssets.forEach(function(asset) {
            var decimals = assetInfo[asset.id].decimals;
            var addString = "";
            if (payments[address][asset.id] < (asset.minPayout * Math.pow(10, decimals))) {
                addString = " **";
            }
            html += "<td>" + (payments[address][asset.id] / Math.pow(10, decimals)).toFixed(decimals) + addString + "</td>";
        });

        if (payout == false) {
            html += "<td>* NO PAYOUT *</td>"
        } else {
            html += "<td></td>"
        }

        html += "</tr>\r\n";

    }	//End for all addresses in payments array

    html += "<tr><td><b>Total amount</b></td><td><b>" + ((totalfees.WAVES / 100000000).toFixed(8)) +
        "</b></td>";

    config.extraAssets.forEach(function (asset) {
        html += "<td><b>" + (totalfees[asset.id] / Math.pow(10, assetInfo[asset.id].decimals)).toFixed(assetInfo[asset.id].decimals) + "</b></td>";
    })

    html += "<td></td></tr>" +
        "\r\n";

    html += "</tbody>" +
        "  </table>" +
        "</div>" +
        "<div class=\"container\">* => Payout will be hold till lowest payout is reached (" + paymentconfigdata.minimumWavesPayout + " WAVES)</div>";
        config.extraAssets.forEach(function(asset) {
            html += "<div class=\"container\">** => Payout will be hold till lowest payout is reached (" + asset.minPayout + " " + assetInfo[asset.id].name + ")</div>"
        });
    html += "</body>" +
        "</html>";


    console.log("total Waves shared (fees + blockrewards): " + (totalfees.WAVES / 100000000).toFixed(8) + " (" + config.percentageOfFeesToDistribute + "%/" + config.percentageOfBlockrewardToDistribute + "%)");
    var paymentfile = config.filename + batchinfo.batchdata.paymentids.lessors + ".json";
    var htmlfile = config.filename + batchinfo.batchdata.paymentids.lessors + ".html";
    var logfile = config.filename + batchinfo.batchdata.paymentids.lessors + ".log";

    fs.writeFile(paymentfile, JSON.stringify({payid: batchinfo.batchdata.paymentids.lessors, blocks: BlockCount, startblock: config.startBlockHeight, endblock: config.endBlock, transactions: transactions}), {}, function (err) {
        if (!err) {
            console.log('Planned payments written to ' + paymentfile + '!');
        } else {
            console.log(err);
        }
    });

    fs.writeFile(htmlfile, html, {}, function (err) {
        if (!err) {
            console.log('HTML written to ' + htmlfile + '!');
        } else {
            console.log(err);
        }
    });

    // Create logfile with paymentinfo for reference and troubleshooting
    var logString = "";
    config.extraAssets.forEach(function (asset) {
        var decimals = assetInfo[asset.id].decimals;
        logString += "Total " + assetInfo[asset.id].name + " fees to lessors: " + (totalfees[asset.id] / Math.pow(10, decimals)).toFixed(decimals) + "\n";
    });
    fs.writeFile(logfile,
        "total Waves fees to lessors: " + (totalfees.WAVES / 100000000).toFixed(8) + "\n"
        + logString
        + "Total blocks forged: " + BlockCount + "\n"
        + "NO PAYOUT Waves: " + (nopaywaves / 100000000).toFixed(8) + "\n"
        + "Payment ID of batch session: " + config.paymentid + "\n"
        + "Payment startblock: " + paymentstartblock + "\n"
        + "Payment stopblock: " + paymentstopblock + "\n"
        + "Distribution: " + paymentconfigdata.feedistributionpercentage + "%\n"
        + "Blockreward sharing: " + blockrewardsharingpercentage + "%\n"
        + "Following addresses are skipped for payment; \n"
        + JSON.stringify(nofeearray) + "\n", function (err) {
            if (!err) {
                console.log('Summarized payoutinfo is written to ' + logfile + "!");
                console.log();
            } else {
                console.log(err);
            }
        });
    // End create logfile

    var latestblockinfo = {};
    latestblockinfo["leases"] = myLeases;
    latestblockinfo["canceledleases"] = myCanceledLeases;
    var blockleases = config.endBlock + "_" + config.address + ".json";

    fs.writeFile(blockleases, JSON.stringify(latestblockinfo), {}, function (err) {
        if (!err) {
            console.log('Leaseinfo written to ' + blockleases + '!');
        } else {
            console.log(err);
        }
    });


    var ActiveLeaseData = getActiveLeasesAtBlock(LastBlock);

    fs.writeFile("LastBlockLeasers.json", JSON.stringify(ActiveLeaseData), {}, function (err) {
        if (!err) {
            console.log('ActiveLeasers written to LastBlockLeasers.json!');
        } else {
            console.log(err);
        }
    });

    config.assetHoldersPayments.forEach(function(asset) {
        // Write html file for each token a part of the fees are send to
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
            "  <h3>Fees between blocks " + config.startBlockHeight + " - " + config.endBlock + ", Payout #" + batchinfo.batchdata.paymentids.assetHolders[asset.id] + ", (Share Tx fees " + asset.feePercentage + "% / Blockreward " + asset.rewardsPercentage + "%)</h3>" +
            "  <h4>(LPOS address: " + config.address + ")</h4>" +
            "  <h5>[ " + date + " ]: Hi all, again a short update of the fee's earned by the wavesnode 'Stake-Waves.Net'. Greetings!</h5> " +
            "  <h5>You can always contact me by <a href=\"mailto:" + mailto + "\">E-mail</a></h5>" +
            "  <h5>Blocks forged: " + BlockCount + "</h5>" +
            "  <table class=\"table table-striped table-hover\">" +
            "    <thead> " +
            "      <tr>" +
            "        <th>Address</th>" +
            "        <th>Waves</th>" +
            "      <th></th></tr>" +
            "    </thead>" +
            "    <tbody>";

        transactions = [];
        var totalPayed = 0;
        var addresses = tokenPayments[asset.id];
        for (var address in addresses) {
            if (Number(Math.round(addresses[address].WAVES)) > 0) {
                transactions.push({
                    "amount": Number(Math.round(addresses[address].WAVES)),
                    "fee": config.feeAmount,
                    "sender": config.address,
                    "attachment": config.paymentAttachment,
                    "recipient": address,
                    "pay": "yes"
                });
                totalPayed += addresses[address].WAVES;
                var addString= '';
                if (addresses[address].WAVES < (paymentconfigdata.minimumWavesPayout * Math.pow(10, 8))) {
                    addString = ' *';
                }
                html += "<tr><td>" + address + "</td><td>" + (addresses[address].WAVES / 100000000).toFixed(8) + addString + "</td></tr>";
            }
        }
        html += "<tr><td><b>Total amount</b></td><td><b>" + (totalPayed / 100000000).toFixed(8) + "</b></td></tr>";
        html += "</tbody>" +
            "  </table>" +
            "</div>" +
            "<div class=\"container\">* => Payout will be hold till lowest payout is reached (0.0001 WAVES)</div>" +
            "</body>" +
            "</html>";
        fs.writeFile(asset.payoutFilePrefix + batchinfo.batchdata.paymentids.assetHolders[asset.id] + '.html', html, {}, function (err) {
            if (err) {
                console.log(err);
                process.exit();
            }
        });
        fs.writeFile(asset.payoutFilePrefix + batchinfo.batchdata.paymentids.assetHolders[asset.id] + '.json', JSON.stringify({payid: batchinfo.batchdata.paymentids.assetHolders[asset.id], blocks: BlockCount, startblock: config.startBlockHeight, endblock: config.endBlock, transactions: transactions}), {}, function (err) {
            if (err) {
                console.log(err);
                process.exit();
            }
        });
        batchinfo.batchdata.paymentids.assetHolders[asset.id]++;
    })

    // Write the current payid of the batch to the payment queue file. This is used by the masspayment tool
    let paymentqueue = function (callback) {

        payarray = [];

        if (fs.existsSync(payqueuefile) == false) {  //There is no paymentqueue file!

            console.log("\nApparently there's no payment queue file yet. Adding paymentid '" + batchinfo.batchdata.paymentids.lessors + "' of current batch to queuefile " + payqueuefile);
            console.log("You can now either start the next collector session, when finished it will automatically be added to the payment queue.");
            console.log("Or you can verify the payment queue with the payment check tool ('start_checker' or 'node checkPayment.js').");
            console.log("All pending payments are automatically found and checked.");
            console.log("Then execute the actual payments, which transfers the revenue shares to all leasers. Start with 'node masstx'.");
            console.log("When the pay job is finished, it is automatically removed from the payment queue file.\n")

            payarray = {lessors: [batchinfo.batchdata.paymentids.lessors], assetHolders: {}};

        } else {       // there is a paymentqueue file!

            rawarray = fs.readFileSync(payqueuefile, function (err, data) { //read it into array
                if (err) {
                    console.log("\nWARNING! Error reading paymentqueue file. terminating tool. Run batch " + payid + " again.\n");
                    return;
                }
            });
            payarray = JSON.parse(rawarray); //read it into array

            //case 1. It's empty
            if (payarray.lessors.length == 0) {
                console.log("\nCurrently there are no payments pending in the queue.");
                console.log("Adding paymentid '" + batchinfo.batchdata.paymentids.lessors + "' to queuefile " + payqueuefile + ". This is the only payment in the queue now :-)\n");
                console.log("You can now either start the next collector session, when finished it will automatically be added to the payment queue.");
                console.log("Or you can verify the pending payment with the payment check tool, 'node checkPaymentsFile.js'.");
                console.log("This will only check, not pay!");
                console.log("If you are satisfied with the checker results (you probably are), then execute the actual payment with 'node masstx'");
                console.log("This will transfer the revenue shares to all leasers!")
                console.log("When the payment is finished, the job id is automatically removed from the payment queue file.\n")

                payarray = {lessors: [batchinfo.batchdata.paymentids.lessors], assetHolders: {}}
            }
            //case 2. It's not empty, but has paymentid duplicates waiting
            else if (payarray.lessors.includes(batchinfo.batchdata.paymentids.lessors) == true) {

                console.log("\nWARNING! Found paymentid " + batchinfo.batchdata.paymentids.lessors + " already in queue. This means there has already ran a batch with this id,\n"
                    + "for which payments were not done yet. If you expect this because you used the old batchinfo file again, then it's fine.\n"
                    + "However, if you weren't expecting a job with same paymentid in the queue (which normally shouldn't), then check logs!!!\n"
                    + "The paymentqueue stays the same and has following payments waiting: [" + payarray + "].\n"
                    + "\nThe batchinfo that was used in the current run is:\n")
                console.log(mybatchdata)
                console.log("\nYou can verify the actual payments that will be done in a dry run first by starting the checkPaymentsFile.js script.\n")
            }
            //case 3. It's not empty. Add current batch to queue
            else {
                console.log("\nFound " + payarray.lessors.length + " pending payments already in queue. Adding current batch with paymentid " + payid + " to the queue.")
                payarray.lessors.push(batchinfo.batchdata.paymentids.lessors);
                console.log("The total queue waiting for payouts is now: " + payarray.lessors);
                console.log("\nTIP")
                console.log("Before you execute your payments, you can lower the needed transaction costs,");
                console.log("by running the optimizer tool, './txoptimizer.py'.")
                console.log("This will merge all pending payments in one larger job!");
                console.log("Start first the checker tool: './start_checker.sh' or 'node checkPaymentsFile.js'");
                console.log("Then start the txoptimizer tool: 'txoptimizer.py' and see the optimized results!")
                console.log("To verify you can start checker tool afterwards again :-)\n")
            }

        }

        nextpayid = batchinfo.batchdata.paymentids.lessors + 1
        console.log("The next batch session will be '" + nextpayid + "'\n");

        config.assetHoldersPayments.forEach(function(asset) {
            if (!(asset.id in payarray.assetHolders)) {
                payarray.assetHolders[asset.id] = [];
            }
            payarray.assetHolders[asset.id].push(batchinfo.batchdata.paymentids.assetHolders[asset.id] - 1);
        })
        fs.writeFileSync(payqueuefile, JSON.stringify(payarray), function (err) {
            if (err) {
                console.log("\nWARNING! Error updating payment queue file. Terminating tool. Run batch " + payid + " again.\n");
                return;
            }
        });
        callback();
    };

    // update json batchdata for next collection round
    let nextbatchdata = function () {

        batchinfo.batchdata.paymentids.lessors++;
        batchinfo.batchdata.paystartblock = paymentstopblock;
        batchinfo.batchdata.paystopblock = paymentstopblock + blockwindowsize;

        fs.writeFile(batchinfofile, JSON.stringify(batchinfo), (err) => {
            if (err) {
                console.log("Something went wrong updating the file:" + batchinfofile + "!");
                console.log(err);
            } else {
                console.log("Batchinfo for next payment round is updated in file " + batchinfofile + "!");
                console.log();
                fs.unlink(appngrunfile, (err) => { //All done, remove run file which is checked during startup
                    if (err) {
                        console.error(err)
                    }
                });
            }
        });
    };

    // update the paymentqueue and callback update batchdata function
    paymentqueue(nextbatchdata);
};

/**
 * This method returns (block-exact) the active leases and the total amount
 * of leased Waves for a given block.
 *
 * @param block the block to consider
 * @returns {{totalLeased: number, activeLeases: {}}} total amount of leased waves and active leases for the given block
 */
var getActiveLeasesAtBlock = function (block) {
    var activeLeases = [];
    var totalLeased = 0;
    var activeLeasesPerAddress = {};

    for (var leaseId in myLeases) {
        var currentLease = myLeases[leaseId];

        if (!myCanceledLeases[leaseId] || myCanceledLeases[leaseId].block > block.height) {
            activeLeases.push(currentLease);
        }
    }
    activeLeases.forEach(function (lease) {
        if (block.height > lease.block + 1000) {
            if (!activeLeasesPerAddress[lease.sender]) {
                activeLeasesPerAddress[lease.sender] = lease.amount;
            } else {
                activeLeasesPerAddress[lease.sender] += lease.amount;
            }

            totalLeased += lease.amount;
        }
    });

    return {totalLeased: totalLeased, activeLeases: activeLeasesPerAddress};
};

var getAssetDistributionAtBlock = function (assetId, block) {
    var addresses = {};
    var moreData = true;
    var first = true;
    var url = '';
    var response = {};
    var totalAssets = 0;
    while (moreData) {
        url = config.node + '/assets/' + assetId + '/distribution/' + block.height + '/limit/1000';
        if (!first) {
            url += '?after=' + response.lastItem;
        }
        response = JSON.parse(request('GET', url,{
            'headers': {
                'Connection': 'keep-alive'
            }
        }).getBody('utf8'));
        moreData = response.hasNext;
        for (address in response.items) {
            if (address !== config.address) {
                addresses[address] = response.items[address];
                totalAssets += response.items[address];
            }
        }
        first = false;
    }
    return {addresses: addresses, totalDistributed: totalAssets};
}

start();
